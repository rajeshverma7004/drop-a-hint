import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendReferralEmail, isValidEmail } from "../services/email.server";
import { createReferral, getReferralByToken, processOrderReferral, validateCouponCode } from "../services/referral.server";

// Helper: replaces the removed json() helper from @react-router/node.
// Returns JSON with standard 200 headers by default so Shopify App Proxy passes
// response through to storefront JS without converting to HTML error pages.
function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

export const loader = async ({ request }) => {
  try {
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
      return jsonResponse({ success: false, error: "Unauthorized" });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    if (action === "get_settings") {
      const productId = url.searchParams.get("productId");

      const globalSettings = await prisma.settings.findUnique({
        where: { shop: session.shop },
      });

      const fallback = globalSettings || {
        discountType: "percentage",
        discountValue: "15",
        customMessage: "",
      };

      if (productId && prisma.productDiscountRule) {
        try {
          const rules = await prisma.productDiscountRule.findMany({
            where: {
              shop: session.shop,
              status: "Active",
            },
          });

          const targetId = String(productId).trim();
          const matchingRule = rules.find((rule) => {
            const pid = String(rule.shopifyProductId).trim();
            return (
              pid === targetId ||
              pid === `gid://shopify/Product/${targetId}` ||
              pid.endsWith(`/${targetId}`)
            );
          });

          if (matchingRule) {
            return jsonResponse({
              discountType: matchingRule.discountType,
              discountValue: matchingRule.discountValue,
              customMessage: fallback.customMessage || "",
              isProductRule: true,
              productTitle: matchingRule.productTitle,
            });
          }
        } catch (err) {
          console.error("Error fetching product discount rule in app proxy:", err);
        }
      }

      return jsonResponse(fallback);
    }

    if (action === "validate_token") {
      const token = url.searchParams.get("token");
      const referral = await getReferralByToken(token, session.shop);
      if (!referral) {
        return jsonResponse({ valid: false, error: "Invalid referral token" });
      }
      return jsonResponse({
        valid: referral.orderStatus === "Pending",
        referral: {
          id: referral.id,
          orderStatus: referral.orderStatus,
          rewardStatus: referral.rewardStatus,
          productId: referral.productId,
        },
      });
    }

    if (action === "validate_coupon") {
      const code = url.searchParams.get("code");
      const email = url.searchParams.get("email");

      const result = await validateCouponCode({
        shop: session?.shop || url.searchParams.get("shop") || undefined,
        code,
        customerEmail: email,
      });

      if (!result.valid) {
        return jsonResponse({
          valid: false,
          isAppCode: result.isAppCode || false,
          isUsed: result.isUsed || false,
          error: result.error,
        });
      }

      return jsonResponse({
        valid: true,
        isAppCode: true,
        isUsed: false,
        coupon: result.referral,
      });
    }

    return jsonResponse({ message: "Drop A Hint App Proxy Active" });
  } catch (err) {
    console.error("[App Proxy Loader Error]:", err);
    return jsonResponse({ success: false, error: err.message || "Server loader error" });
  }
};

export const action = async ({ request }) => {
  try {
    const { session, admin } = await authenticate.public.appProxy(request);

    if (!session) {
      return jsonResponse({ success: false, error: "Unauthorized session" });
    }

    const url = new URL(request.url);
    const actionType = url.searchParams.get("action");

    if (actionType === "submit_referral") {
      let data;
      try {
        data = await request.json();
      } catch (err) {
        console.error("Failed to parse submit_referral JSON payload:", err);
        return jsonResponse({ success: false, error: "Invalid JSON request body" });
      }

      const {
        senderName,
        senderEmail,
        referrerCustomerId,
        receiverName,
        receiverEmail,
        productUrl,
        productId,
        productTitle,
        productPrice,
        productCompareAtPrice,
        productImage,
        customMessage,
      } = data || {};

      // Debug logging for pricing & referral submission
      console.log('[Drop A Hint] submit_referral payload:');
      console.log('  Sender Name       :', senderName);
      console.log('  Sender Email      :', senderEmail);
      console.log('  Referrer Cust. ID :', referrerCustomerId || '(none)');
      console.log('  Receiver Name     :', receiverName);
      console.log('  Receiver Email    :', receiverEmail);
      console.log('  Product ID        :', productId);
      console.log('  Product Title     :', productTitle);
      console.log('  Sale Price        :', productPrice || '(not provided)');
      console.log('  Compare-At Price  :', productCompareAtPrice || '(none — not on sale)');

      // Input Validation
      if (!senderName || !senderName.trim()) {
        return jsonResponse({ success: false, error: "Your Name is required" });
      }
      if (!senderEmail || !isValidEmail(senderEmail)) {
        return jsonResponse({ success: false, error: "A valid email for 'Your Email' is required" });
      }
      if (!receiverName || !receiverName.trim()) {
        return jsonResponse({ success: false, error: "Friend's Name is required" });
      }
      if (!receiverEmail || !isValidEmail(receiverEmail)) {
        return jsonResponse({ success: false, error: "A valid email for 'Friend's Email' is required" });
      }

      // Step 1: Create Referral Record with Reward Snapshot
      let referralResult;
      try {
        referralResult = await createReferral({
          shop: session.shop,
          senderName,
          senderEmail,
          referrerCustomerId,
          receiverName,
          receiverEmail,
          productUrl,
          productId,
          productTitle,
        });
      } catch (dbErr) {
        console.error("[Referral DB Error] Failed to create referral:", dbErr);
        return jsonResponse({
          success: false,
          error: dbErr.message || "Could not save referral. Please try again later.",
        });
      }

      const { referral, token } = referralResult;

      // Safe URL construction for invitation link (handles relative/missing URLs gracefully)
      let referralUrlStr = productUrl || `https://${session.shop}`;
      try {
        const parsedUrl = new URL(referralUrlStr, `https://${session.shop}`);
        parsedUrl.searchParams.set("dah_ref", token);
        parsedUrl.searchParams.set("referral", token);
        parsedUrl.searchParams.set("ref", token);
        referralUrlStr = parsedUrl.toString();
      } catch (urlErr) {
        console.warn("[Referral URL Warning] Could not parse productUrl:", productUrl, urlErr.message);
        const sep = referralUrlStr.includes("?") ? "&" : "?";
        referralUrlStr = `${referralUrlStr}${sep}dah_ref=${token}&referral=${token}&ref=${token}`;
      }

      // Step 2: Send Invitation Email to Friend via SendGrid
      let emailSent = false;
      let emailErrorMessage = null;
      try {
        const storeSettings = await prisma.settings.findUnique({
          where: { shop: session.shop },
        });

        await sendReferralEmail({
          senderName,
          senderEmail,
          receiverName,
          receiverEmail,
          productTitle,
          productUrl: referralUrlStr,
          productImage,
          productPrice,
          productCompareAtPrice: productCompareAtPrice || '',
          customMessage: customMessage || `${senderName} thought you would like this product!`,
          shop: session.shop,
          configuredSenderEmail: storeSettings?.senderEmail,
          configuredEmailSubject: storeSettings?.emailSubject,
        });
        emailSent = true;
        console.log(`[REFERRAL] recipient email sent`);
        console.log(`[REFERRAL] attribution captured`);
      } catch (emailErr) {
        emailErrorMessage = emailErr?.message || "Email delivery failed";
        console.error(
          `[Referral Email Error] Referral saved (ID: ${referral.id}), but friend invitation email delivery failed:`,
          emailErrorMessage
        );
      }

      if (!emailSent) {
        return jsonResponse({
          success: false,
          error: `Referral saved, but email delivery failed: ${emailErrorMessage}`,
          referral: {
            id: referral.id,
            token: referral.token,
            orderStatus: referral.orderStatus,
            rewardStatus: referral.rewardStatus,
          },
        });
      }

      return jsonResponse({
        success: true,
        message: "Referral submitted successfully! Invitation sent to friend.",
        referral: {
          id: referral.id,
          token: referral.token,
          orderStatus: referral.orderStatus,
          rewardStatus: referral.rewardStatus,
        },
      });
    }

    if (actionType === "complete_order") {
      let data;
      try {
        data = await request.json();
      } catch (err) {
        return jsonResponse({ success: false, error: "Invalid JSON body" });
      }

      const adminGraphqlClient = admin?.graphql ?? null;

      console.log("[App Proxy] complete_order triggered.");
      console.log("  Shop:", session.shop);
      console.log("  Admin client available:", !!adminGraphqlClient);

      const updatedReferral = await processOrderReferral({
        shop:         session.shop,
        order:        data?.order || data,
        adminGraphql: adminGraphqlClient,
      });

      if (!updatedReferral) {
        return jsonResponse({ success: false, error: "No matching pending referral found for this order" });
      }

      return jsonResponse({ success: true, referral: updatedReferral });
    }

    return jsonResponse({ success: false, error: "Invalid action" });
  } catch (err) {
    console.error("[App Proxy Action Error]:", err);
    return jsonResponse({ success: false, error: err.message || "Server processing error" });
  }
};
