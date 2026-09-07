import { randomUUID } from "crypto";
import prisma from "../db.server.js";
import { sanitizeInput, isValidEmail, sendRewardEmail } from "./email.server.js";
import { unauthenticated } from "../shopify.server.js";

/**
 * Generate a clean uppercase alphanumeric discount code (e.g., REF-RAJESH-8K92 or REF-A7K92X)
 */
export function generateDiscountCode(referrerName = "") {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let randomPart = "";
  for (let i = 0; i < 6; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const cleanName = String(referrerName || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);

  if (cleanName.length >= 3) {
    return `REF-${cleanName}-${randomPart.slice(0, 4)}`;
  }
  return `REF-${randomPart}`;
}

/**
 * Strips 'gid://shopify/Product/' or other GID prefix for clean string comparison
 */
export function cleanShopifyId(id) {
  if (!id) return "";
  return String(id)
    .replace(/^gid:\/\/shopify\/(Product|Order|Customer|DiscountCodeNode|PriceRule|LineItem)\//i, "")
    .trim();
}

/**
 * Creates a real redeemable Shopify discount via the modern Admin GraphQL API
 * (discountCodeBasicCreate mutation) so the code works instantly at checkout.
 *
 * @param {object} params
 * @param {function} params.adminGraphql       - Shopify Admin GraphQL client
 * @param {string}  params.code                - The discount code string to create
 * @param {string}  params.discountType        - "percentage" | "fixed"
 * @param {string|number} params.discountValue - Numeric value (e.g. 15)
 * @param {number}  params.expiryDays          - Days until expiry (0 = no expiry)
 * @returns {{ success: boolean, discountCodeId?: string, error?: string, code: string }}
 */
export async function createShopifyDiscountCode({
  adminGraphql,
  code,
  discountType,
  discountValue,
  expiryDays = 30,
}) {
  if (!adminGraphql) {
    console.warn("[REWARD-DISCOUNT] ⚠️ No adminGraphql client provided — cannot create Shopify discount.");
    return { success: false, error: "No admin client available", code };
  }

  const isPercentage = discountType === "percentage";
  const numValue = Math.abs(parseFloat(discountValue)) || 15;

  const startsAt = new Date().toISOString();
  const endsAt =
    expiryDays > 0
      ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

  try {
    console.log(`[REWARD-DISCOUNT] Creating Basic Code Discount in Shopify: code=${code}, type=${discountType}, value=${numValue}`);

    const mutation = `#graphql
      mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode {
            id
            codeDiscount {
              ... on DiscountCodeBasic {
                title
                codes(first: 1) {
                  nodes {
                    code
                  }
                }
              }
            }
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    const basicCodeDiscount = {
      title: `Referral Reward - ${code}`,
      code,
      startsAt,
      ...(endsAt ? { endsAt } : {}),
      usageLimit: 1,
      appliesOncePerCustomer: true,
      customerSelection: {
        all: true,
      },
      customerGets: {
        value: isPercentage
          ? { percentage: numValue / 100 }
          : { discountAmount: { amount: numValue, appliesOnEachItem: false } },
        items: {
          all: true,
        },
      },
    };

    const response = await adminGraphql(mutation, {
      variables: { basicCodeDiscount },
    });
    const data = await response.json();
    const userErrors = data?.data?.discountCodeBasicCreate?.userErrors || [];

    if (userErrors.length > 0) {
      const errMsg = userErrors.map((e) => `${e.field}: ${e.message}`).join("; ");
      console.error("[REWARD-DISCOUNT] ❌ Discount code creation userErrors:", errMsg);
      return { success: false, error: errMsg, code };
    }

    const discountNodeId = data?.data?.discountCodeBasicCreate?.codeDiscountNode?.id;
    const finalCode =
      data?.data?.discountCodeBasicCreate?.codeDiscountNode?.codeDiscount?.codes?.nodes?.[0]?.code || code;

    console.log(`[REWARD-DISCOUNT] ✅ Shopify Discount Code created successfully: ${finalCode} (ID: ${discountNodeId})`);

    return { success: true, discountCodeId: discountNodeId, code: finalCode };
  } catch (err) {
    console.error("[REWARD-DISCOUNT] ❌ Exception creating Shopify discount code:", err.message || err);
    return { success: false, error: err.message || String(err), code };
  }
}

/**
 * Creates a new Referral record and captures an immutable snapshot
 * of the reward configuration (rewardType, rewardValue) at referral creation time.
 */
export async function createReferral({
  shop,
  senderName,
  senderEmail,
  referrerCustomerId,
  receiverName,
  receiverEmail,
  productUrl,
  productId,
  productTitle,
}) {
  const cleanSenderName = sanitizeInput(senderName);
  const cleanSenderEmail = sanitizeInput(senderEmail).toLowerCase();
  const cleanReceiverName = sanitizeInput(receiverName);
  const cleanReceiverEmail = sanitizeInput(receiverEmail).toLowerCase();
  const cleanProductUrl = sanitizeInput(productUrl) || "";
  const cleanProductId = productId ? String(productId).trim() : null;
  const cleanProductTitle = productTitle ? sanitizeInput(productTitle) : null;
  const cleanReferrerCustomerId = referrerCustomerId ? String(referrerCustomerId).trim() : null;

  if (!cleanSenderName) throw new Error("Sender Name is required");
  if (!isValidEmail(cleanSenderEmail)) throw new Error("Valid Sender Email is required");
  if (!cleanReceiverName) throw new Error("Receiver Name is required");
  if (!isValidEmail(cleanReceiverEmail)) throw new Error("Valid Receiver Email is required");

  // 1. Snapshot Reward Configuration at this moment
  let rewardType = "percentage";
  let rewardValue = "15";

  if (cleanProductId && prisma.productDiscountRule) {
    try {
      const rules = await prisma.productDiscountRule.findMany({
        where: { shop, status: "Active" },
      });
      const matchingRule = rules.find((rule) => {
        const pid = cleanShopifyId(rule.shopifyProductId);
        const targetPid = cleanShopifyId(cleanProductId);
        return pid === targetPid;
      });

      if (matchingRule) {
        rewardType = matchingRule.discountType || "percentage";
        rewardValue = matchingRule.discountValue || "15";
      }
    } catch (ruleErr) {
      console.warn("[REFERRAL] Warning reading product discount rules:", ruleErr.message);
    }
  }

  // If no product rule matched, check global store settings
  if (rewardType === "percentage" && rewardValue === "15") {
    try {
      const storeSettings = await prisma.settings.findUnique({ where: { shop } });
      if (storeSettings) {
        rewardType = storeSettings.discountType || rewardType;
        rewardValue = storeSettings.discountValue || rewardValue;
      }
    } catch (setErr) {
      console.warn("[REFERRAL] Warning reading store settings:", setErr.message);
    }
  }

  // 2. Generate unique tracking token
  const token = `ref_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

  // 3. Prepare referral creation record
  const referralData = {
    shop,
    senderName: cleanSenderName,
    senderEmail: cleanSenderEmail,
    receiverName: cleanReceiverName,
    receiverEmail: cleanReceiverEmail,
    productUrl: cleanProductUrl,
    productId: cleanProductId,
    token,
    rewardType,
    rewardValue,
    orderStatus: "Pending",
    rewardStatus: "Not Rewarded",
    failureReason: "WAITING_FOR_ORDER",
    rewardIssued: false,
    couponSent: false,
  };

  if (cleanProductTitle) {
    referralData.productTitle = cleanProductTitle;
  }
  if (cleanReferrerCustomerId) {
    referralData.referrerCustomerId = cleanReferrerCustomerId;
  }

  // Resilient DB creation with automatic retry if active Prisma client lacks an optional column
  let referral;
  const currentData = { ...referralData };
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      referral = await prisma.referral.create({ data: currentData });
      break;
    } catch (err) {
      const match = err.message && err.message.match(/Unknown argument `([^`]+)`/);
      if (match && match[1] && currentData[match[1]] !== undefined) {
        console.warn(`[REFERRAL] Prisma Client lacks '${match[1]}' column in active runtime. Omitting field for backward compatibility.`);
        delete currentData[match[1]];
      } else {
        throw err;
      }
    }
  }

  console.log("\n==================== [REFERRAL CREATED] ====================");
  console.log(`[REFERRAL] created`);
  console.log(`[REFERRAL] token=${token}`);
  console.log(`[REFERRAL] Referral ID:          #${referral.id}`);
  console.log(`[REFERRAL] Shop:                 ${shop}`);
  console.log(`[REFERRAL] Referrer (A):         ${cleanSenderName} (${cleanSenderEmail})`);
  console.log(`[REFERRAL] Friend (B):           ${cleanReceiverName} (${cleanReceiverEmail})`);
  console.log(`[REFERRAL] Product ID:           ${cleanProductId || "N/A"}`);
  console.log(`[REFERRAL] Product Title:        ${cleanProductTitle || "N/A"}`);
  console.log(`[REFERRAL] Token Generated:      ${token}`);
  console.log(`[REFERRAL] Reward Snapshot:      ${rewardValue}${rewardType === "percentage" ? "%" : " Fixed"}`);
  console.log(`[REFERRAL] Initial Status:       Order=${referral.orderStatus}, Reward=${referral.rewardStatus}`);
  console.log("============================================================\n");

  return { referral, token };
}

/**
 * Fetch a referral by token
 */
export async function getReferralByToken(token, shop) {
  if (!token) return null;
  const cleanToken = token.trim();
  return prisma.referral.findFirst({
    where: {
      token: cleanToken,
      ...(shop ? { shop } : {}),
    },
  });
}

// In-memory Promise lock map to serialize concurrent requests within the same Node.js worker
const processingLocks = new Map();

/**
 * Dispatches reward email to Customer A with atomic DB locking.
 * Separated from reward creation: guarantees that retries will only resend the existing coupon code.
 */
export async function dispatchRewardEmailSafely({ shop, referral }) {
  if (!referral || !referral.discountCode) return referral;

  if (referral.rewardEmailSent) {
    console.log(`[REWARD] referralId=${referral.id} email already sent=true`);
    return referral;
  }

  // Atomic lock on email dispatch to prevent concurrent threads from double-sending
  const emailClaim = await prisma.referral.updateMany({
    where: {
      id: referral.id,
      rewardEmailSent: false,
    },
    data: {
      rewardEmailSent: true,
      rewardEmailSentAt: new Date(),
      rewardProcessingState: "EMAIL_SENT",
    },
  });

  if (emailClaim.count === 0) {
    console.log(`[REWARD] referralId=${referral.id} email already claimed or sent by concurrent worker. Skipping.`);
    return referral;
  }

  const maskedRecipient = referral.senderEmail
    ? `${referral.senderEmail.slice(0, 3)}•••@${referral.senderEmail.split("@")[1] || ""}`
    : "(none)";
  console.log(`[EMAIL] sending reward email`);
  console.log(`[EMAIL] reward email trigger started`);
  console.log(`[EMAIL] recipient=${maskedRecipient}`);

  const storeSettings = await prisma.settings.findUnique({
    where: { shop },
  });

  try {
    await sendRewardEmail({
      senderName: referral.senderName,
      senderEmail: referral.senderEmail,
      discountCode: referral.discountCode,
      discountAmount: referral.discountAmount || `${referral.rewardValue}% OFF`,
      shop,
      configuredSenderEmail: storeSettings?.confirmationSenderEmail,
      configuredEmailSubject: storeSettings?.confirmationEmailSubject,
    });
    console.log(`[EMAIL] reward email sent`);
    await prisma.referral.update({
      where: { id: referral.id },
      data: { couponSent: true, failureReason: "REWARDED" },
    });
    return { ...referral, rewardEmailSent: true, couponSent: true };
  } catch (emailErr) {
    console.error(`[EMAIL] reward email failed:`, emailErr.message || emailErr);
    // Release email lock on failure so merchant/webhook can retry sending the SAME code
    await prisma.referral.update({
      where: { id: referral.id },
      data: {
        rewardEmailSent: false,
        failureReason: "EMAIL_FAILED",
      },
    });
    return { ...referral, rewardEmailSent: false, failureReason: "EMAIL_FAILED" };
  }
}

/**
 * Issues a reward discount code to Customer A after Friend B's order is confirmed as PAID.
 * Fully IDEMPOTENT & CONCURRENCY-SAFE:
 * - In-memory Mutex lock
 * - Database-level unique constraint via RewardIssuanceLog
 * - Atomic conditional state transition (PENDING -> PROCESSING -> ISSUED -> EMAIL_SENT)
 * - Separate discount creation from email dispatch
 */
export async function issueReferralReward({ shop, referral, adminGraphql, order }) {
  if (!referral || !shop) return null;
  const referralId = Number(referral.id);
  const orderId = order ? cleanShopifyId(order.id) : (referral.orderId || referral.referredOrderId || "unknown");

  const lockKey = `${shop}:${referralId}`;

  // If another execution in this process is currently running for this referral, await its completion
  if (processingLocks.has(lockKey)) {
    console.log(`[REWARD] referralId=${referralId} waiting for active in-process lock`);
    try {
      await processingLocks.get(lockKey);
    } catch (e) {
      // Ignore lock error
    }
  }

  let resolveLock;
  const lockPromise = new Promise((resolve) => { resolveLock = resolve; });
  processingLocks.set(lockKey, lockPromise);

  try {
    return await executeIssueReferralReward({ shop, adminGraphql, order, referralId, orderId });
  } finally {
    processingLocks.delete(lockKey);
    if (resolveLock) resolveLock();
  }
}

async function executeIssueReferralReward({ shop, adminGraphql, order, referralId, orderId }) {
  console.log(`\n==================== [REWARD ISSUANCE STARTED] ====================`);
  console.log(`[REWARD] referralId=${referralId} processing started`);
  console.log(`[REWARD] orderId=${orderId}`);

  // 1. Fetch latest DB state
  const currentReferral = await prisma.referral.findUnique({
    where: { id: referralId },
  });

  if (!currentReferral) {
    console.log(`[REWARD] ❌ Referral #${referralId} not found in database.`);
    return null;
  }

  // 2. IDEMPOTENCY GUARD: If discount code already exists, DO NOT create another discount!
  if (
    currentReferral.rewardIssued === true ||
    currentReferral.rewardStatus === "Rewarded" ||
    currentReferral.orderStatus === "Reward Redeemed" ||
    (currentReferral.discountCode && currentReferral.discountCode.startsWith("REF-"))
  ) {
    console.log(`[REWARD] existing reward found=true (code: ${currentReferral.discountCode})`);
    console.log(`[REWARD] discount creation skipped`);

    // Ensure email is sent if discount exists but email was previously pending/failed
    if (!currentReferral.rewardEmailSent) {
      await dispatchRewardEmailSafely({ shop, referral: currentReferral });
    } else {
      console.log(`[REWARD] email already sent=true`);
    }

    console.log(`[REWARD] processing finished`);
    return currentReferral;
  }

  // 3. DATABASE UNIQUE CHECK: Check RewardIssuanceLog
  const existingLog = await prisma.rewardIssuanceLog.findFirst({
    where: {
      shop,
      OR: [
        { referralId },
        ...(orderId && orderId !== "unknown" ? [{ orderId: String(orderId) }] : []),
      ],
    },
  });

  if (existingLog) {
    console.log(`[REWARD] existing RewardIssuanceLog found (code: ${existingLog.discountCode})`);
    console.log(`[REWARD] discount creation skipped`);
    const updated = await prisma.referral.update({
      where: { id: referralId },
      data: {
        orderStatus: "Paid",
        rewardStatus: "Rewarded",
        rewardProcessingState: "ISSUED",
        discountCode: existingLog.discountCode,
        discountId: existingLog.discountId,
        rewardIssued: true,
        rewardIssuedAt: existingLog.createdAt,
        paymentStatus: "paid",
        completedAt: existingLog.createdAt,
      },
    });

    if (!updated.rewardEmailSent) {
      await dispatchRewardEmailSafely({ shop, referral: updated });
    }
    console.log(`[REWARD] processing finished`);
    return updated;
  }

  // 4. ATOMIC DATABASE LOCK: Transition state from PENDING/FAILED to PROCESSING
  const lockAcquired = await prisma.referral.updateMany({
    where: {
      id: referralId,
      shop,
      rewardIssued: false,
      OR: [
        { rewardProcessingState: "PENDING" },
        { rewardProcessingState: "FAILED" },
        // Reclaim abandoned lock if processing crashed > 2 minutes ago
        {
          AND: [
            { rewardProcessingState: "PROCESSING" },
            { processingLockAt: { lt: new Date(Date.now() - 120000) } },
          ],
        },
      ],
    },
    data: {
      rewardProcessingState: "PROCESSING",
      processingLockAt: new Date(),
    },
  });

  if (lockAcquired.count === 0) {
    console.log(`[REWARD] ⚠️ Atomic lock not acquired (another worker is processing or completed reward).`);
    const ref = await prisma.referral.findUnique({ where: { id: referralId } });
    console.log(`[REWARD] existing reward found=${!!ref?.rewardIssued}`);
    console.log(`[REWARD] discount creation skipped`);
    console.log(`[REWARD] processing finished`);
    return ref;
  }

  // 5. CREATE SHOPIFY DISCOUNT CODE
  console.log(`[REWARD] creating reward`);
  const discountType = currentReferral.rewardType || "percentage";
  const discountValue = currentReferral.rewardValue || "15";
  const discountAmountStr =
    discountType === "percentage" ? `${discountValue}% OFF` : `$${discountValue} OFF`;

  const rewardCouponCode = generateDiscountCode(currentReferral.senderName);
  const now = new Date();

  let expiryDays = 30;
  try {
    const storeSettings = await prisma.settings.findUnique({ where: { shop } });
    if (storeSettings?.expiryDays) {
      expiryDays = storeSettings.expiryDays;
    }
  } catch (e) {
    // default 30
  }

  let activeAdminGraphql = adminGraphql;
  if (!activeAdminGraphql && shop) {
    try {
      const unauth = await unauthenticated.admin(shop);
      activeAdminGraphql = unauth?.admin?.graphql ?? null;
    } catch (unauthErr) {
      console.warn(`[REWARD] Could not get unauthenticated admin client for ${shop}:`, unauthErr.message);
    }
  }

  let shopifyDiscountResult = { success: false, code: rewardCouponCode };
  if (activeAdminGraphql) {
    shopifyDiscountResult = await createShopifyDiscountCode({
      adminGraphql: activeAdminGraphql,
      code: rewardCouponCode,
      discountType,
      discountValue,
      expiryDays,
    });
  } else {
    console.warn("[REWARD] ⚠️ No active admin GraphQL client available — discount code will be local-only.");
  }

  const finalCouponCode = shopifyDiscountResult.code || rewardCouponCode;
  console.log(`[REWARD] discount created=${finalCouponCode}`);

  // 6. ATOMIC SAVE TO DATABASE & ISSUANCE LOG (Single Database Transaction)
  let updatedReferral;
  try {
    const [savedReferral] = await prisma.$transaction([
      prisma.referral.update({
        where: { id: referralId },
        data: {
          orderStatus: "Paid",
          rewardStatus: "Rewarded",
          rewardProcessingState: "ISSUED",
          failureReason: "REWARDED",
          discountId: shopifyDiscountResult.discountCodeId || null,
          discountCode: finalCouponCode,
          discountAmount: discountAmountStr,
          rewardIssued: true,
          rewardIssuedAt: now,
          completedAt: now,
          paymentStatus: "paid",
          ...(order?.financial_status ? { paymentStatus: String(order.financial_status).toLowerCase() } : {}),
        },
      }),
      prisma.rewardIssuanceLog.upsert({
        where: { shop_referralId: { shop, referralId } },
        update: {
          discountCode: finalCouponCode,
          discountId: shopifyDiscountResult.discountCodeId || null,
          orderId: String(orderId),
        },
        create: {
          shop,
          referralId,
          orderId: String(orderId),
          discountCode: finalCouponCode,
          discountId: shopifyDiscountResult.discountCodeId || null,
        },
      }),
    ]);
    updatedReferral = savedReferral;
    console.log(`[REWARD] reward saved`);
  } catch (txErr) {
    console.error(`[REWARD] ❌ Transaction error saving reward:`, txErr.message);
    await prisma.referral.update({
      where: { id: referralId },
      data: {
        rewardProcessingState: "FAILED",
        failureReason: "REWARD_CREATION_FAILED",
      },
    });
    throw txErr;
  }

  // 7. SEPARATE ATOMIC EMAIL DISPATCH
  const emailResult = await dispatchRewardEmailSafely({ shop, referral: updatedReferral });
  if (emailResult) {
    updatedReferral = { ...updatedReferral, ...emailResult };
  }

  console.log(`[REWARD] processing finished`);
  console.log(`===================================================================\n`);

  return updatedReferral;
}

/**
 * Process order creation or payment event:
 * - Checks if Customer A is redeeming an existing reward code in this order.
 * - Extracts referral attribution tokens from all order channels.
 * - Matches Friend B's purchase to a referral record.
 * - If order is unpaid: sets status to 'Purchased' (Pending Payment), no reward issued.
 * - If order is paid: sets status to 'Paid' and triggers reward issuance.
 */
export async function processOrderReferral({ shop, order, adminGraphql, allowRewardIssuance = true }) {
  if (!order || !shop) return null;

  const orderId = cleanShopifyId(order.id);
  const orderNumberStr = String(order.order_number || order.name || "").trim();
  const orderNumber = orderNumberStr.startsWith("#") ? orderNumberStr : `#${orderNumberStr}`;
  const customerEmail = String(order.email || order.customer?.email || "").trim().toLowerCase();
  const shopifyCustomerId = order.customer?.id ? cleanShopifyId(order.customer.id) : null;
  const financialStatus = String(order.financial_status || order.displayFinancialStatus || "paid").toLowerCase();
  const isPaid = financialStatus === "paid";
  const orderAmount = order.total_price || order.totalPriceSet?.shopMoney?.amount ? String(order.total_price || order.totalPriceSet?.shopMoney?.amount) : null;

  console.log(`[ORDER] order created`);
  console.log(`[ORDER] order id=${orderId}`);

  // ---------------------------------------------------------------------------
  // 1. EXTRACT REFERRAL TOKEN FROM ALL POSSIBLE ORDER ATTRIBUTES
  // ---------------------------------------------------------------------------
  let noteToken = null;

  // Check note_attributes / attributes / custom_attributes / customAttributes
  const noteAttributes = order.note_attributes || order.attributes || order.custom_attributes || order.customAttributes || [];
  if (Array.isArray(noteAttributes)) {
    const refAttr = noteAttributes.find((attr) => {
      const key = String(attr.name || attr.key || "").toLowerCase().trim();
      return key === "dah_ref" || key === "referral" || key === "ref" || key === "dah_token" || key === "_dah_ref";
    });
    if (refAttr && refAttr.value) {
      noteToken = String(refAttr.value).trim();
    }
  } else if (typeof noteAttributes === "object" && noteAttributes !== null) {
    noteToken = String(noteAttributes.dah_ref || noteAttributes.referral || noteAttributes.ref || noteAttributes._dah_ref || "").trim() || null;
  }

  // Check line_items / lineItems properties
  const rawLineItems = Array.isArray(order.line_items) ? order.line_items : (order.lineItems?.edges?.map(e => e.node) || []);
  if (!noteToken && Array.isArray(rawLineItems)) {
    for (const item of rawLineItems) {
      const props = item.properties || item.custom_attributes || item.customAttributes || [];
      if (Array.isArray(props)) {
        const prop = props.find((p) => {
          const k = String(p.name || p.key || "").toLowerCase().trim();
          return k === "_dah_ref" || k === "dah_ref" || k === "referral" || k === "ref";
        });
        if (prop && prop.value) {
          noteToken = String(prop.value).trim();
          break;
        }
      } else if (typeof props === "object" && props !== null) {
        const val = props._dah_ref || props.dah_ref || props.referral || props.ref;
        if (val) {
          noteToken = String(val).trim();
          break;
        }
      }
    }
  }

  // Check order note text for token pattern
  if (!noteToken && typeof order.note === "string") {
    const match = order.note.match(/(?:dah_ref|referral|ref)[:=\s]+([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      noteToken = match[1].trim();
    }
  }

  // Extract discount codes used in the order (for redemption tracking)
  const discountCodes = (order.discount_codes || order.discountCodes || []).map((dc) =>
    String(dc.code || dc || "").trim().toUpperCase()
  );

  // Extract line items product IDs & titles
  const orderLineItems = rawLineItems.map((item) => ({
    productId: cleanShopifyId(item.product_id || item.product?.id),
    title: String(item.title || item.name || item.product_title || item.product?.title || "").trim(),
  }));
  const orderProductIds = orderLineItems.map((i) => i.productId).filter(Boolean);

  console.log("\n==================== [PROCESS ORDER REFERRAL] ====================");
  console.log(`[ORDER] Shop:               ${shop}`);
  console.log(`[ORDER] Order ID:           ${orderId}`);
  console.log(`[ORDER] Order Number:       ${orderNumber}`);
  console.log(`[ORDER] Customer Email:     ${customerEmail || "(none)"}`);
  console.log(`[ORDER] Customer ID:        ${shopifyCustomerId || "(none)"}`);
  console.log(`[ORDER] Financial Status:   ${financialStatus} (isPaid: ${isPaid})`);
  console.log(`[ORDER] Extracted Token:    ${noteToken || "(none)"}`);
  console.log(`[ORDER] Discount Codes:     ${discountCodes.join(", ") || "(none)"}`);
  console.log(`[ORDER] Product IDs in Cart:${orderProductIds.join(", ") || "(none)"}`);
  console.log("==================================================================\n");

  // ---------------------------------------------------------------------------
  // STEP A: Check if Customer A redeemed an issued reward code in this order
  // ---------------------------------------------------------------------------
  if (discountCodes.length > 0) {
    for (const code of discountCodes) {
      const existingRewarded = await prisma.referral.findFirst({
        where: {
          shop,
          discountCode: code,
          rewardStatus: "Rewarded",
        },
      });

      if (existingRewarded) {
        await prisma.referral.update({
          where: { id: existingRewarded.id },
          data: {
            orderStatus: "Reward Redeemed",
            rewardStatus: "Redeemed",
            failureReason: "REDEEMED",
            redeemedAt: new Date(),
            redeemingOrderId: orderId,
            redeemingOrderNumber: orderNumber,
            usedCount: { increment: 1 },
          },
        });

        console.log(`[ORDER-REDEMPTION] ✅ Reward discount code '${code}' was REDEEMED in order ${orderNumber}!`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // STEP B: Multi-Tier Referral Matching Strategy
  // Tier 1 → Token matching (dah_ref in note attributes / properties)
  // Tier 2 → Shopify Customer ID matching
  // Tier 3 → Customer email + product matching
  // ---------------------------------------------------------------------------
  let matchingReferral = null;

  // Tier 1: Match by Token
  if (noteToken) {
    matchingReferral = await prisma.referral.findFirst({
      where: {
        shop,
        token: noteToken,
      },
    });

    if (matchingReferral) {
      console.log(`[REFERRAL DEBUG] orderId=${orderId} customerId=${shopifyCustomerId} customerEmail=${customerEmail} lineItemProductIds=${orderProductIds.join(",")} referralToken=${noteToken} referralId=${matchingReferral.id}`);
      console.log(`[REFERRAL-MATCH] ✅ Matched by unique token '${noteToken}' → Referral #${matchingReferral.id}`);
    }
  }

  // Tier 2: Match by Shopify Customer ID
  if (!matchingReferral && shopifyCustomerId) {
    matchingReferral = await prisma.referral.findFirst({
      where: {
        shop,
        shopifyCustomerId,
        orderStatus: { in: ["Pending", "Purchased"] },
      },
    });

    if (matchingReferral) {
      console.log(`[REFERRAL-MATCH] ✅ Matched by Shopify Customer ID '${shopifyCustomerId}' → Referral #${matchingReferral.id}`);
    }
  }

  // Tier 3: Match by Customer Email + Product
  if (!matchingReferral && customerEmail) {
    const candidateReferrals = await prisma.referral.findMany({
      where: {
        shop,
        receiverEmail: { equals: customerEmail },
        orderStatus: { in: ["Pending", "Purchased"] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (candidateReferrals && candidateReferrals.length > 0) {
      console.log(`[REFERRAL-MATCH] Found ${candidateReferrals.length} candidate referral(s) for email '${customerEmail}'`);

      // Try matching by product ID first
      matchingReferral = candidateReferrals.find((ref) => {
        if (!ref.productId) return false;
        const refPid = cleanShopifyId(ref.productId);
        return orderProductIds.some((pid) => pid === refPid);
      });

      // Try matching by product title if product ID didn't match
      if (!matchingReferral) {
        matchingReferral = candidateReferrals.find((ref) => {
          if (!ref.productTitle) return false;
          const refTitle = ref.productTitle.toLowerCase().trim();
          return orderLineItems.some((item) => item.title && item.title.toLowerCase().trim() === refTitle);
        });
      }

      // If referral had no product constraint (general referral)
      if (!matchingReferral) {
        matchingReferral = candidateReferrals.find((ref) => !ref.productId);
      }

      // Fallback: match the most recent pending referral for this friend
      if (!matchingReferral) {
        matchingReferral = candidateReferrals[0];
      }

      if (matchingReferral) {
        console.log(`[REFERRAL DEBUG] orderId=${orderId} customerId=${shopifyCustomerId} customerEmail=${customerEmail} lineItemProductIds=${orderProductIds.join(",")} referralToken=${noteToken || "none"} referralId=${matchingReferral.id}`);
        console.log(`[REFERRAL-MATCH] ✅ Matched by email '${customerEmail}' → Referral #${matchingReferral.id}`);
      }
    }
  }

  console.log(`[REFERRAL MATCH] referral found=${!!matchingReferral}`);
  console.log(`[PAYMENT] paid=${isPaid}`);

  // If no referral matched this order
  if (!matchingReferral) {
    console.log(`[ORDER] ℹ️ No matching referral found for order ${orderNumber}.`);
    return null;
  }

  // Idempotency check: if referral is already rewarded, skip duplicate execution
  if (
    matchingReferral.rewardIssued === true ||
    matchingReferral.rewardStatus === "Rewarded" ||
    matchingReferral.orderStatus === "Reward Redeemed"
  ) {
    console.log(`[ORDER] ⚠️ Referral #${matchingReferral.id} is already rewarded. Idempotent skip.`);
    return matchingReferral;
  }

  // Determine line item product
  const matchedLineItem = (() => {
    if (!matchingReferral.productId) return orderLineItems[0] || null;
    const refPid = cleanShopifyId(matchingReferral.productId);
    return (
      orderLineItems.find((item) => item.productId === refPid) ||
      orderLineItems.find((item) => matchingReferral.productTitle && item.title && item.title.toLowerCase().trim() === matchingReferral.productTitle.toLowerCase().trim()) ||
      orderLineItems[0] ||
      null
    );
  })();

  const purchasedProductId = matchedLineItem?.productId || matchingReferral.productId;
  const purchasedProductTitle = matchedLineItem?.title || matchingReferral.productTitle;
  const purchaseDate = new Date();

  // Prepare order update payload
  const orderUpdateData = {
    orderId,
    referredOrderId: orderId,
    orderNumber,
    referredOrderNumber: orderNumber,
    referredCustomerId: shopifyCustomerId || matchingReferral.referredCustomerId,
    referredCustomerEmail: customerEmail || matchingReferral.referredCustomerEmail,
    orderAmount: orderAmount || matchingReferral.orderAmount,
    paymentStatus: financialStatus,
    productId: purchasedProductId,
    productTitle: purchasedProductTitle,
    purchaseDate,
    ...(shopifyCustomerId ? { shopifyCustomerId } : {}),
  };

  // ---------------------------------------------------------------------------
  // STEP C: PAYMENT & REWARD GATING
  // If allowRewardIssuance is false (e.g. from orders/create webhook):
  // Record order attribution only. DO NOT generate discount codes or send emails.
  // ---------------------------------------------------------------------------
  if (!allowRewardIssuance) {
    console.log(`[ORDER] ℹ️ Order ${orderNumber} attribution recorded (allowRewardIssuance=false). Reward generation strictly gated to orders/paid webhook.`);
    orderUpdateData.orderStatus = "Purchased";
    orderUpdateData.rewardStatus = isPaid ? "Payment Confirmed (Awaiting Paid Webhook)" : "Pending Payment";
    orderUpdateData.failureReason = isPaid ? "WAITING_FOR_ORDER" : "PAYMENT_NOT_CONFIRMED";

    const updatedReferral = await prisma.referral.update({
      where: { id: matchingReferral.id },
      data: orderUpdateData,
    });
    return updatedReferral;
  }

  // If order is UNPAID (financial_status !== "paid"):
  // Update referral to 'Purchased' (Pending Payment). DO NOT issue reward code!
  if (!isPaid) {
    console.log(`[ORDER-PAYMENT] ⏳ Order ${orderNumber} is UNPAID ('${financialStatus}'). Setting referral #${matchingReferral.id} to 'Purchased' (Pending Payment).`);
    orderUpdateData.orderStatus = "Purchased";
    orderUpdateData.rewardStatus = "Pending Payment";
    orderUpdateData.failureReason = "PAYMENT_NOT_CONFIRMED";

    const updatedReferral = await prisma.referral.update({
      where: { id: matchingReferral.id },
      data: orderUpdateData,
    });
    return updatedReferral;
  }

  // Order IS PAID and allowRewardIssuance is TRUE: proceed with canonical reward generation
  console.log(`[ORDER-PAYMENT] 💳 Order ${orderNumber} is PAID! Confirming payment for referral #${matchingReferral.id} and issuing reward to Customer A.`);
  orderUpdateData.orderStatus = "Paid";
  orderUpdateData.failureReason = "REWARDED";

  const preUpdatedReferral = await prisma.referral.update({
    where: { id: matchingReferral.id },
    data: orderUpdateData,
  });

  return issueReferralReward({
    shop,
    referral: { ...matchingReferral, ...preUpdatedReferral },
    adminGraphql,
    order,
  });
}

/**
 * Diagnostic & Reconciliation Tool:
 * Safe helper to inspect an existing pending referral, scan recent Shopify orders,
 * verify payment, and reconcile the reward if an order was placed.
 */
export async function reconcileReferralById({ shop, referralId, adminGraphql }) {
  if (!referralId || !shop) {
    return { success: false, error: "Referral ID and shop are required" };
  }

  const referral = await prisma.referral.findFirst({
    where: { id: parseInt(referralId, 10), shop },
  });

  if (!referral) {
    return { success: false, error: `Referral #${referralId} not found` };
  }

  // If already rewarded
  if (referral.rewardIssued === true || referral.rewardStatus === "Rewarded") {
    return {
      success: true,
      message: `Referral #${referral.id} is already rewarded with discount code ${referral.discountCode}`,
      referral,
    };
  }

  if (!adminGraphql) {
    try {
      const unauth = await unauthenticated.admin(shop);
      adminGraphql = unauth?.admin?.graphql ?? null;
    } catch (e) {
      console.warn("[RECONCILE] Could not obtain admin client:", e.message);
    }
  }

  if (!adminGraphql) {
    return { success: false, error: "No Shopify Admin API access available" };
  }

  console.log(`\n[RECONCILE] Scanning Shopify orders for Referral #${referral.id} (Token: ${referral.token}, Friend: ${referral.receiverEmail})`);

  // Query recent Shopify orders (last 50 orders)
  const ordersQuery = `#graphql
    query getRecentOrdersForReconciliation {
      orders(first: 50, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            displayFinancialStatus
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            customer {
              id
              email
              displayName
            }
            customAttributes {
              key
              value
            }
            lineItems(first: 20) {
              edges {
                node {
                  id
                  title
                  product {
                    id
                    title
                  }
                  customAttributes {
                    key
                    value
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await adminGraphql(ordersQuery);
  const data = await response.json();
  const orderEdges = data?.data?.orders?.edges || [];
  const orders = orderEdges.map((e) => e.node);

  let matchedOrder = null;
  let matchReason = "";

  // 1. Search by token in customAttributes or line item customAttributes
  for (const o of orders) {
    const noteAttrs = o.customAttributes || [];
    const hasNoteToken = noteAttrs.some((a) => {
      const k = (a.key || a.name || "").toLowerCase().trim();
      return (k === "dah_ref" || k === "referral" || k === "ref" || k === "_dah_ref") && String(a.value).trim() === referral.token;
    });

    if (hasNoteToken) {
      matchedOrder = o;
      matchReason = `Order note attribute token '${referral.token}'`;
      break;
    }

    const lineItems = o.lineItems?.edges?.map((e) => e.node) || [];
    const hasLineToken = lineItems.some((item) => {
      const props = item.customAttributes || [];
      return props.some((p) => {
        const k = (p.key || p.name || "").toLowerCase().trim();
        return (k === "_dah_ref" || k === "dah_ref" || k === "referral" || k === "ref") && String(p.value).trim() === referral.token;
      });
    });

    if (hasLineToken) {
      matchedOrder = o;
      matchReason = `Line item property token '${referral.token}'`;
      break;
    }
  }

  // 2. Search by Friend email + product if token was not in attributes
  if (!matchedOrder && referral.receiverEmail) {
    const friendEmail = referral.receiverEmail.toLowerCase().trim();
    for (const o of orders) {
      const orderEmail = String(o.customer?.email || "").toLowerCase().trim();
      if (orderEmail === friendEmail) {
        const lineItems = o.lineItems?.edges?.map((e) => e.node) || [];
        const hasProduct = lineItems.some((item) => {
          const pid = cleanShopifyId(item.product?.id);
          const refPid = cleanShopifyId(referral.productId);
          return pid === refPid || (item.title && item.title.toLowerCase().trim() === (referral.productTitle || "").toLowerCase().trim());
        });

        if (hasProduct) {
          matchedOrder = o;
          matchReason = `Customer email '${friendEmail}' + referred product`;
          break;
        }
      }
    }
  }

  if (!matchedOrder) {
    return {
      success: false,
      message: `No matching Shopify purchase found yet for Referral #${referral.id} (searched token '${referral.token}' and email '${referral.receiverEmail}'). Customer B has not completed a purchase with this referral.`,
      referral,
    };
  }

  console.log(`[RECONCILE] ✅ Found matching order ${matchedOrder.name} via ${matchReason}!`);

  const updatedReferral = await processOrderReferral({
    shop,
    order: matchedOrder,
    adminGraphql,
  });

  return {
    success: true,
    message: `Reconciled Referral #${referral.id} with Shopify Order ${matchedOrder.name} (${matchReason})!`,
    referral: updatedReferral || referral,
  };
}

/**
 * Handles order cancellation or refund events
 */
export async function handleOrderCancellationOrRefund({ shop, order, adminGraphql }) {
  if (!order || !shop) return null;
  const orderId = cleanShopifyId(order.id);

  const referral = await prisma.referral.findFirst({
    where: {
      shop,
      OR: [{ orderId }, { referredOrderId: orderId }],
    },
  });

  if (!referral) return null;

  const isCancelled = Boolean(order.cancelled_at || order.cancel_reason);
  const isRefunded =
    order.financial_status === "refunded" ||
    order.financial_status === "partially_refunded";

  if (isCancelled) {
    console.log(`[CANCELLATION] Order ${orderId} was cancelled. Updating referral #${referral.id} to Cancelled.`);

    // If discount was issued but not yet redeemed, delete the discount code in Shopify
    if (adminGraphql && referral.discountId && referral.usedCount === 0) {
      try {
        const deleteQuery = `#graphql
          mutation discountCodeDelete($id: ID!) {
            discountCodeDelete(id: $id) {
              deletedCodeDiscountId
              userErrors {
                field
                message
              }
            }
          }
        `;
        await adminGraphql(deleteQuery, { variables: { id: referral.discountId } });
        console.log(`[CANCELLATION] Disabled unused Shopify Discount ${referral.discountId}`);
      } catch (delErr) {
        console.warn("[CANCELLATION] Could not delete Shopify discount:", delErr.message);
      }
    }

    return prisma.referral.update({
      where: { id: referral.id },
      data: {
        orderStatus: "Cancelled",
        rewardStatus: "Cancelled",
        paymentStatus: "cancelled",
        failureReason: "ORDER_CANCELLED",
      },
    });
  }

  if (isRefunded) {
    console.log(`[REFUND] Order ${orderId} was refunded. Updating referral #${referral.id} to Refunded.`);
    return prisma.referral.update({
      where: { id: referral.id },
      data: {
        orderStatus: "Refunded",
        paymentStatus: String(order.financial_status),
        failureReason: "ORDER_REFUNDED",
      },
    });
  }

  return referral;
}

/**
 * Validate a coupon code for redemption or checkout verification
 */
export async function validateCouponCode({ shop, code, customerEmail }) {
  if (!code) {
    return { valid: false, isAppCode: false, isUsed: false, error: "Coupon code is required" };
  }

  const cleanCode = code.trim().toUpperCase();

  // Find referral record matching this discount code (optionally filtering by shop)
  const referral = await prisma.referral.findFirst({
    where: {
      ...(shop ? { shop } : {}),
      discountCode: cleanCode,
    },
    orderBy: { createdAt: "desc" },
  });

  // Also check RewardIssuanceLog if not found in Referral table directly
  const issuanceLog = !referral
    ? await prisma.rewardIssuanceLog.findFirst({
        where: {
          ...(shop ? { shop } : {}),
          discountCode: cleanCode,
        },
        orderBy: { createdAt: "desc" },
      })
    : null;

  if (!referral && !issuanceLog) {
    return {
      valid: false,
      isAppCode: false,
      isUsed: false,
      error: "Invalid or non-existent coupon code",
    };
  }

  // Resolve target referral record if matched via issuanceLog
  const targetReferral =
    referral ||
    (issuanceLog?.referralId
      ? await prisma.referral.findUnique({ where: { id: issuanceLog.referralId } })
      : null);

  const isUsed = Boolean(
    targetReferral &&
      (targetReferral.redeemedAt !== null ||
        targetReferral.orderStatus === "Reward Redeemed" ||
        targetReferral.rewardStatus === "Redeemed" ||
        (typeof targetReferral.usedCount === "number" && targetReferral.usedCount >= 1))
  );

  if (isUsed) {
    return {
      valid: false,
      isAppCode: true,
      isUsed: true,
      error: "Coupon code has already been redeemed",
    };
  }

  if (customerEmail && targetReferral?.senderEmail) {
    if (customerEmail.trim().toLowerCase() !== targetReferral.senderEmail.trim().toLowerCase()) {
      return {
        valid: false,
        isAppCode: true,
        isUsed: false,
        error: "This coupon code belongs to another customer account",
      };
    }
  }

  return {
    valid: true,
    isAppCode: true,
    isUsed: false,
    referral: targetReferral
      ? {
          id: targetReferral.id,
          discountCode: targetReferral.discountCode,
          discountAmount: targetReferral.discountAmount,
          senderEmail: targetReferral.senderEmail,
        }
      : {
          discountCode: cleanCode,
        },
  };
}

/**
 * Retries sending the reward email to Customer A using the already-generated discount code.
 * Safe & Idempotent: Does NOT generate duplicate discount codes.
 */
export async function retryRewardEmail({ shop, referralId }) {
  if (!referralId || !shop) {
    return { success: false, error: "Missing referralId or shop" };
  }

  const referral = await prisma.referral.findFirst({
    where: {
      id: Number(referralId),
      shop,
    },
  });

  if (!referral) {
    return { success: false, error: "Referral not found" };
  }

  if (!referral.discountCode) {
    return { success: false, error: "No discount code exists on this referral yet. Process/reconcile the order first." };
  }

  const maskedRecipient = referral.senderEmail ? `${referral.senderEmail.slice(0, 3)}•••@${referral.senderEmail.split("@")[1] || ""}` : "(none)";
  console.log(`[EMAIL] reward email trigger started`);
  console.log(`[EMAIL] recipient=${maskedRecipient}`);

  const storeSettings = await prisma.settings.findUnique({
    where: { shop },
  });

  try {
    await sendRewardEmail({
      senderName: referral.senderName,
      senderEmail: referral.senderEmail,
      discountCode: referral.discountCode,
      discountAmount: referral.discountAmount || `${referral.rewardValue}% OFF`,
      shop,
      configuredSenderEmail: storeSettings?.confirmationSenderEmail,
      configuredEmailSubject: storeSettings?.confirmationEmailSubject,
    });

    const now = new Date();
    const updated = await prisma.referral.update({
      where: { id: referral.id },
      data: {
        rewardEmailSent: true,
        rewardEmailSentAt: now,
        couponSent: true,
        failureReason: "REWARDED",
      },
    });

    console.log(`[EMAIL] sent=true`);
    return { success: true, message: `Reward email sent successfully to ${referral.senderEmail}!`, referral: updated };
  } catch (err) {
    console.error(`[EMAIL] sent=false error:`, err.message);
    const updated = await prisma.referral.update({
      where: { id: referral.id },
      data: {
        failureReason: "EMAIL_FAILED",
      },
    });
    return { success: false, error: `Email delivery failed: ${err.message}`, referral: updated };
  }
}

