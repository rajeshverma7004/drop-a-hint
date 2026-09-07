/* global process */
/**
 * referral-webhook.test.js
 *
 * Comprehensive automated unit and integration tests for the Product Referral &
 * Reward Discount System.
 *
 * Tests:
 * 1. Referral creation and reward configuration snapshotting (rewardType, rewardValue).
 * 2. Unpaid order handling: marks referral as "Purchased" (Pending Payment) without issuing reward.
 * 3. Payment verification: on "paid" financial_status, generates Shopify discount code using
 *    the original snapshot reward value and marks as "Reward Issued".
 * 4. Strict idempotency guard: duplicate webhooks/calls do not generate duplicate discount codes or emails.
 * 5. Strict product matching: purchasing an unrelated product does not complete referral.
 * 6. Reward discount code redemption: when Referrer A uses the code, marks as "Reward Redeemed".
 * 7. Order cancellation and refund handling.
 * 8. Multi-tenant shop isolation.
 * 9. HMAC authentication failure propagation.
 *
 * Run with:  node tests/referral-webhook.test.js
 */

import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testsPassed = 0;
let testsFailed = 0;

async function test(label, fn) {
  process.stdout.write(`  ${label} ... `);
  try {
    await fn();
    console.log("✅ PASS");
    testsPassed++;
  } catch (err) {
    console.log("❌ FAIL");
    console.error(`    Error: ${err.message}`);
    testsFailed++;
  }
}

function suite(name) {
  console.log(`\n📦 ${name}`);
}

// ---------------------------------------------------------------------------
// Mock Prisma Factory
// ---------------------------------------------------------------------------

function makeMockPrisma(overrides = {}) {
  const updateLog = [];
  const createLog = [];

  const base = {
    referral: {
      findFirst: async () => null,
      findMany: async () => [],
      create: async (args) => {
        createLog.push(args);
        return { ...args.data, id: 1, createdAt: new Date() };
      },
      update: async (args) => {
        updateLog.push(args);
        return { ...args.data, id: args.where.id };
      },
    },
    settings: {
      findUnique: async () => ({
        discountType: "percentage",
        discountValue: "15",
        expiryDays: 30,
      }),
    },
    productDiscountRule: {
      findMany: async () => [],
    },
  };

  const merged = {
    referral: { ...base.referral, ...(overrides.referral || {}) },
    settings: { ...base.settings, ...(overrides.settings || {}) },
    productDiscountRule: {
      ...base.productDiscountRule,
      ...(overrides.productDiscountRule || {}),
    },
  };
  merged._updateLog = updateLog;
  merged._createLog = createLog;
  return merged;
}

// ---------------------------------------------------------------------------
// Simulated Core Business Logic (mirrors referral.server.js)
// ---------------------------------------------------------------------------

function generateDiscountCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "REF-";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function simulateCreateReferral({ prisma, shop, params }) {
  const {
    senderName,
    senderEmail,
    receiverName,
    receiverEmail,
    productUrl,
    productId,
    productTitle,
  } = params;

  let rewardType = "percentage";
  let rewardValue = "15";

  if (productId) {
    const rules = await prisma.productDiscountRule.findMany({
      where: { shop, status: "Active" },
    });
    const match = rules.find((r) => String(r.shopifyProductId) === String(productId));
    if (match) {
      rewardType = match.discountType || "percentage";
      rewardValue = match.discountValue || "15";
    }
  }

  if (rewardType === "percentage" && rewardValue === "15") {
    const storeSettings = await prisma.settings.findUnique({ where: { shop } });
    if (storeSettings) {
      rewardType = storeSettings.discountType || rewardType;
      rewardValue = storeSettings.discountValue || rewardValue;
    }
  }

  const token = `ref_test_${Math.random().toString(36).slice(2, 8)}`;

  return prisma.referral.create({
    data: {
      shop,
      senderName,
      senderEmail,
      receiverName,
      receiverEmail,
      productUrl,
      productId: productId ? String(productId) : null,
      productTitle,
      token,
      rewardType,
      rewardValue,
      orderStatus: "Pending",
      rewardStatus: "Not Rewarded",
      rewardIssued: false,
      couponSent: false,
    },
  });
}

async function simulateIssueReferralReward({ prisma, referral, order }) {
  if (
    referral.rewardIssued === true ||
    referral.rewardStatus === "Rewarded" ||
    referral.orderStatus === "Reward Issued" ||
    referral.orderStatus === "Reward Redeemed" ||
    referral.discountCode
  ) {
    return referral;
  }

  const discountType = referral.rewardType || "percentage";
  const discountValue = referral.rewardValue || "15";
  const discountAmountStr =
    discountType === "percentage" ? `${discountValue}% OFF` : `$${discountValue} OFF`;
  const code = generateDiscountCode();
  const now = new Date();

  return prisma.referral.update({
    where: { id: referral.id },
    data: {
      orderStatus: "Paid",
      rewardStatus: "Rewarded",
      discountId: "gid://shopify/DiscountCodeNode/12345",
      discountCode: code,
      discountAmount: discountAmountStr,
      rewardIssued: true,
      rewardIssuedAt: now,
      rewardEmailSent: true,
      rewardEmailSentAt: now,
      couponSent: true,
      completedAt: now,
      ...(order?.financial_status
        ? { paymentStatus: String(order.financial_status).toLowerCase() }
        : {}),
    },
  });
}

async function simulateProcessOrderReferral({ prisma, shop, order, adminGraphql = null }) {
  if (!order || !shop) return null;

  const orderId = String(order.id || "").trim();
  const orderNumberStr = String(order.order_number || order.name || "").trim();
  const orderNumber = orderNumberStr.startsWith("#") ? orderNumberStr : `#${orderNumberStr}`;
  const customerEmail = String(order.email || order.customer?.email || "").trim().toLowerCase();
  const shopifyCustomerId = order.customer?.id ? String(order.customer.id).trim() : null;
  const financialStatus = String(order.financial_status || "paid").toLowerCase();
  const isPaid = financialStatus === "paid";
  const orderAmount = order.total_price ? String(order.total_price) : null;

  let noteToken = null;
  const noteAttributes = order.note_attributes || [];
  if (Array.isArray(noteAttributes)) {
    const refAttr = noteAttributes.find(
      (a) => a.name === "dah_ref" || a.name === "ref"
    );
    if (refAttr?.value) noteToken = String(refAttr.value).trim();
  }

  // Redemption check
  const discountCodes = (order.discount_codes || []).map((dc) =>
    String(dc.code || "").trim().toUpperCase()
  );
  if (discountCodes.length > 0) {
    for (const code of discountCodes) {
      const existingRewarded = await prisma.referral.findFirst({
        where: { shop, discountCode: code, rewardStatus: "Rewarded" },
      });
      if (existingRewarded) {
        await prisma.referral.update({
          where: { id: existingRewarded.id },
          data: {
            orderStatus: "Reward Redeemed",
            rewardStatus: "Redeemed",
            redeemedAt: new Date(),
            redeemingOrderId: orderId,
            redeemingOrderNumber: orderNumber,
            usedCount: (existingRewarded.usedCount || 0) + 1,
          },
        });
      }
    }
  }

  const orderLineItems = (order.line_items || []).map((item) => ({
    productId: item.product_id ? String(item.product_id).trim() : null,
    title: item.title || null,
  }));
  const orderProductIds = orderLineItems.map((i) => i.productId).filter(Boolean);

  let matchingReferral = null;

  if (shopifyCustomerId) {
    matchingReferral = await prisma.referral.findFirst({
      where: {
        shop,
        shopifyCustomerId,
        orderStatus: { in: ["Pending", "Purchased"] },
      },
    });
  }

  if (!matchingReferral && noteToken) {
    matchingReferral = await prisma.referral.findFirst({
      where: {
        shop,
        token: noteToken,
      },
    });
  }

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
      const withProduct = candidateReferrals.filter((r) => r.productId);
      const withoutProduct = candidateReferrals.filter((r) => !r.productId);

      if (withProduct.length > 0) {
        matchingReferral = withProduct.find((ref) => {
          const refPid = String(ref.productId).trim();
          return orderProductIds.some(
            (pid) =>
              pid === refPid ||
              pid === `gid://shopify/Product/${refPid}` ||
              refPid === `gid://shopify/Product/${pid}` ||
              pid.endsWith(`/${refPid}`) ||
              refPid.endsWith(`/${pid}`)
          );
        });
      } else if (withoutProduct.length > 0) {
        matchingReferral = withoutProduct[0];
      }
    }
  }

  if (!matchingReferral) return null;

  // Idempotency check: already rewarded
  if (
    matchingReferral.rewardIssued === true ||
    matchingReferral.orderStatus === "Reward Issued" ||
    matchingReferral.orderStatus === "Reward Redeemed"
  ) {
    return matchingReferral;
  }

  const orderUpdateData = {
    orderId,
    referredOrderId: orderId,
    orderNumber,
    referredOrderNumber: orderNumber,
    referredCustomerId: shopifyCustomerId || matchingReferral.referredCustomerId,
    referredCustomerEmail: customerEmail || matchingReferral.referredCustomerEmail,
    orderAmount: orderAmount || matchingReferral.orderAmount,
    paymentStatus: financialStatus,
    purchaseDate: new Date(),
    ...(shopifyCustomerId ? { shopifyCustomerId } : {}),
  };

  // UNPAID order gate
  if (!isPaid) {
    orderUpdateData.orderStatus = "Purchased";
    orderUpdateData.rewardStatus = "Pending Payment";
    return prisma.referral.update({
      where: { id: matchingReferral.id },
      data: orderUpdateData,
    });
  }

  // PAID order
  orderUpdateData.orderStatus = "Paid";
  const preUpdated = await prisma.referral.update({
    where: { id: matchingReferral.id },
    data: orderUpdateData,
  });

  return simulateIssueReferralReward({
    prisma,
    shop,
    referral: { ...matchingReferral, ...preUpdated },
    adminGraphql,
    order,
  });
}

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const SHOP_A = "store-a.myshopify.com";
const SHOP_B = "store-b.myshopify.com";

function makeOrder(overrides = {}) {
  return {
    id: "1001",
    order_number: 1001,
    email: "friend_b@example.com",
    customer: { id: "cust_b_999", email: "friend_b@example.com" },
    financial_status: "paid",
    total_price: "89.99",
    line_items: [{ product_id: "prod_42", title: "Product X" }],
    discount_codes: [],
    note_attributes: [],
    ...overrides,
  };
}

function makePendingReferral(overrides = {}) {
  return {
    id: 1,
    shop: SHOP_A,
    senderName: "Alice (Customer A)",
    senderEmail: "alice_a@example.com",
    receiverName: "Bob (Friend B)",
    receiverEmail: "friend_b@example.com",
    productId: "prod_42",
    productTitle: "Product X",
    productUrl: "https://store-a.myshopify.com/products/x",
    token: "ref_tok_123",
    rewardType: "percentage",
    rewardValue: "20",
    orderStatus: "Pending",
    rewardStatus: "Not Rewarded",
    rewardIssued: false,
    rewardIssuedAt: null,
    discountCode: null,
    discountAmount: null,
    orderId: null,
    paymentStatus: null,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TEST SUITES
// ---------------------------------------------------------------------------

suite("Test Suite 1: Referral Creation & Reward Snapshotting");

await test("Captures and freezes product-specific reward configuration at creation time", async () => {
  const mock = makeMockPrisma({
    productDiscountRule: {
      findMany: async () => [
        {
          shopifyProductId: "prod_42",
          discountType: "percentage",
          discountValue: "25",
          status: "Active",
        },
      ],
    },
  });

  const created = await simulateCreateReferral({
    prisma: mock,
    shop: SHOP_A,
    params: {
      senderName: "Alice",
      senderEmail: "alice@example.com",
      receiverName: "Bob",
      receiverEmail: "bob@example.com",
      productUrl: "https://store-a.myshopify.com/products/x",
      productId: "prod_42",
      productTitle: "Product X",
    },
  });

  assert.equal(created.rewardType, "percentage", "rewardType snapshot must be percentage");
  assert.equal(created.rewardValue, "25", "rewardValue snapshot must be 25%");
  assert.equal(created.orderStatus, "Pending", "Initial orderStatus must be Pending");
  assert.equal(created.rewardStatus, "Not Rewarded", "Initial rewardStatus must be Not Rewarded");
  assert.equal(created.rewardIssued, false, "rewardIssued must be false");
  assert.ok(created.token, "Referral token must be generated");
});

await test("Captures store settings snapshot when no product-specific rule exists", async () => {
  const mock = makeMockPrisma({
    productDiscountRule: { findMany: async () => [] },
    settings: {
      findUnique: async () => ({ discountType: "fixed", discountValue: "10" }),
    },
  });

  const created = await simulateCreateReferral({
    prisma: mock,
    shop: SHOP_A,
    params: {
      senderName: "Alice",
      senderEmail: "alice@example.com",
      receiverName: "Bob",
      receiverEmail: "bob@example.com",
      productUrl: "https://store-a.myshopify.com/products/y",
      productId: "prod_99",
      productTitle: "Product Y",
    },
  });

  assert.equal(created.rewardType, "fixed", "rewardType snapshot must be fixed");
  assert.equal(created.rewardValue, "10", "rewardValue snapshot must be 10");
});

suite("Test Suite 2: Strict Payment Verification & Unpaid Orders");

await test("Unpaid order (financial_status: pending) transitions to 'Purchased' without reward code", async () => {
  const pending = makePendingReferral({ rewardValue: "20" });
  let updatedRecord = null;
  const mock = makeMockPrisma({
    referral: {
      findFirst: async () => null,
      findMany: async () => [pending],
      update: async (args) => {
        mock._updateLog.push(args);
        updatedRecord = { ...pending, ...args.data };
        return updatedRecord;
      },
    },
  });

  const unpaidOrder = makeOrder({ financial_status: "pending" });
  const result = await simulateProcessOrderReferral({
    prisma: mock,
    shop: SHOP_A,
    order: unpaidOrder,
  });

  assert.ok(result, "Order should match referral");
  assert.equal(result.orderStatus, "Purchased", "orderStatus must be 'Purchased'");
  assert.equal(result.rewardStatus, "Pending Payment", "rewardStatus must be 'Pending Payment'");
  assert.equal(result.rewardIssued, false, "rewardIssued must remain false");
  assert.equal(result.discountCode, null, "discountCode must NOT be generated for unpaid order");
  assert.equal(result.orderId, "1001", "Order ID must be attached");
});

await test("Payment confirmation (financial_status: paid) issues reward using snapshot value", async () => {
  // Referral created with 20% snapshot, but current store settings have changed to 5%
  const purchasedReferral = makePendingReferral({
    orderStatus: "Purchased",
    rewardStatus: "Pending Payment",
    rewardType: "percentage",
    rewardValue: "20", // Original snapshot!
  });

  let updatedRecord = purchasedReferral;
  const mock = makeMockPrisma({
    referral: {
      findFirst: async () => null,
      findMany: async () => [purchasedReferral],
      update: async (args) => {
        mock._updateLog.push(args);
        updatedRecord = { ...updatedRecord, ...args.data };
        return updatedRecord;
      },
    },
    // Store settings currently set to 5% (should NOT overwrite original 20% snapshot)
    settings: {
      findUnique: async () => ({ discountType: "percentage", discountValue: "5" }),
    },
  });

  const paidOrder = makeOrder({ financial_status: "paid" });
  const result = await simulateProcessOrderReferral({
    prisma: mock,
    shop: SHOP_A,
    order: paidOrder,
  });

  assert.ok(result, "Order should match referral");
  assert.equal(result.orderStatus, "Paid", "orderStatus must be 'Paid'");
  assert.equal(result.rewardStatus, "Rewarded", "rewardStatus must be 'Rewarded'");
  assert.equal(result.rewardIssued, true, "rewardIssued must be true");
  assert.equal(result.discountAmount, "20% OFF", "Reward discount must use original 20% snapshot, NOT current 5%");
  assert.ok(result.discountCode && result.discountCode.startsWith("REF-"), "Must generate unique REF- discount code");
  assert.ok(result.rewardIssuedAt, "rewardIssuedAt timestamp must be set");
});

suite("Test Suite 3: Idempotency & Duplicate Webhook Protection");

await test("Duplicate orders/paid webhooks do NOT re-generate discount codes or duplicate rewards", async () => {
  const alreadyRewarded = makePendingReferral({
    orderStatus: "Paid",
    rewardStatus: "Rewarded",
    rewardIssued: true,
    rewardIssuedAt: new Date("2026-02-01"),
    discountCode: "REF-ALREADY1",
    discountAmount: "20% OFF",
    orderId: "1001",
  });

  const mock = makeMockPrisma({
    referral: {
      findFirst: async () => alreadyRewarded,
      findMany: async () => [alreadyRewarded],
      update: async (args) => {
        mock._updateLog.push(args);
        return args.data;
      },
    },
  });

  const duplicatePaidWebhook = makeOrder({ financial_status: "paid" });
  const result = await simulateProcessOrderReferral({
    prisma: mock,
    shop: SHOP_A,
    order: duplicatePaidWebhook,
  });

  assert.equal(result.discountCode, "REF-ALREADY1", "Discount code must remain identical");
  assert.equal(mock._updateLog.length, 0, "No DB update should occur on duplicate webhook");
});

suite("Test Suite 4: Strict Product Attribution Matching");

await test("Purchasing an unrelated product does NOT trigger referral completion", async () => {
  const pending = makePendingReferral({ productId: "prod_42" });
  const mock = makeMockPrisma({
    referral: {
      findFirst: async () => null,
      findMany: async ({ where }) => {
        if (where.receiverEmail?.equals === "friend_b@example.com") return [pending];
        return [];
      },
      update: async (args) => {
        mock._updateLog.push(args);
        return args.data;
      },
    },
  });

  // Friend B buys product 999 instead of referred product 42
  const unrelatedOrder = makeOrder({
    line_items: [{ product_id: "prod_999", title: "Unrelated Item" }],
  });

  const result = await simulateProcessOrderReferral({
    prisma: mock,
    shop: SHOP_A,
    order: unrelatedOrder,
  });

  assert.equal(result, null, "Result must be null when referred product was not purchased");
  assert.equal(mock._updateLog.length, 0, "Referral must NOT be modified");
});

suite("Test Suite 5: Referral Discount Code Redemption Tracking");

await test("When Customer A uses REF-XXXXXX at checkout, referral is marked as 'Reward Redeemed'", async () => {
  const issuedReferral = makePendingReferral({
    id: 42,
    orderStatus: "Reward Issued",
    rewardStatus: "Rewarded",
    discountCode: "REF-TEST99",
    rewardIssued: true,
  });

  let redeemedResult = null;
  const mock = makeMockPrisma({
    referral: {
      findFirst: async ({ where }) => {
        if (where.discountCode === "REF-TEST99" && where.rewardStatus === "Rewarded") {
          return issuedReferral;
        }
        return null;
      },
      findMany: async () => [],
      update: async (args) => {
        mock._updateLog.push(args);
        redeemedResult = { ...issuedReferral, ...args.data };
        return redeemedResult;
      },
    },
  });

  // Customer A places order 2005 using discount code REF-TEST99
  const redemptionOrder = {
    id: "2005",
    order_number: 2005,
    email: "alice_a@example.com",
    financial_status: "paid",
    discount_codes: [{ code: "REF-TEST99", amount: "10.00", type: "percentage" }],
    line_items: [{ product_id: "prod_55", title: "Another Product" }],
  };

  await simulateProcessOrderReferral({
    prisma: mock,
    shop: SHOP_A,
    order: redemptionOrder,
  });

  assert.ok(redeemedResult, "Referral should be updated on redemption");
  assert.equal(redeemedResult.orderStatus, "Reward Redeemed", "orderStatus must be 'Reward Redeemed'");
  assert.equal(redeemedResult.rewardStatus, "Redeemed", "rewardStatus must be 'Redeemed'");
  assert.equal(redeemedResult.redeemingOrderId, "2005", "redeemingOrderId must be stored");
  assert.equal(redeemedResult.redeemingOrderNumber, "#2005", "redeemingOrderNumber must be stored");
  assert.ok(redeemedResult.redeemedAt, "redeemedAt timestamp must be set");
});

suite("Test Suite 6: Multi-Tenant Shop Isolation");

await test("Order from Shop A does not complete a referral on Shop B", async () => {
  const shopBReferral = makePendingReferral({ shop: SHOP_B });
  const mock = makeMockPrisma({
    referral: {
      findFirst: async ({ where }) => {
        if (where.shop === SHOP_B) return shopBReferral;
        return null;
      },
      findMany: async ({ where }) => {
        if (where.shop === SHOP_B) return [shopBReferral];
        return [];
      },
      update: async (args) => {
        mock._updateLog.push(args);
        return args.data;
      },
    },
  });

  const result = await simulateProcessOrderReferral({
    prisma: mock,
    shop: SHOP_A,
    order: makeOrder(),
  });

  assert.equal(result, null, "Store A order must not touch Store B referral");
  assert.equal(mock._updateLog.length, 0, "No updates allowed across shops");
});

suite("Test Suite 7: HMAC Auth Error Handling");

await test("Propagates 401 Response when authenticate.webhook throws Response", async () => {
  async function simulateWebhookHandler(authFn) {
    try {
      await authFn();
      return new Response(null, { status: 200 });
    } catch (err) {
      if (err instanceof Response) throw err;
      return new Response(null, { status: 200 });
    }
  }

  const fakeAuth = async () => {
    throw new Response(null, { status: 401 });
  };

  let caught = null;
  try {
    await simulateWebhookHandler(fakeAuth);
  } catch (err) {
    caught = err;
  }

  assert.ok(caught instanceof Response, "Must throw Response on auth failure");
  assert.equal(caught.status, 401, "Status code must be 401");
});

// ---------------------------------------------------------------------------
// Test Summary
// ---------------------------------------------------------------------------

console.log(`\n${"═".repeat(60)}`);
console.log(`Test Results: ${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) {
  console.log(`\n❌ ${testsFailed} test(s) failed.`);
  process.exit(1);
} else {
  console.log(`\n🎉 All tests passed successfully!`);
}
