import { authenticate } from "../shopify.server";
import { handleOrderCancellationOrRefund } from "../services/referral.server";

/**
 * POST /webhooks/orders/cancelled
 *
 * Fired by Shopify when an order is cancelled.
 * HMAC verification is handled automatically by authenticate.webhook().
 * Safely updates referral status to Cancelled and disables unredeemed rewards.
 */
export const action = async ({ request }) => {
  try {
    const { payload, shop, topic, admin } = await authenticate.webhook(request);
    console.log(`[Webhook Received] ${topic} for shop: ${shop}`);

    if (payload) {
      await handleOrderCancellationOrRefund({
        shop,
        order: payload,
        adminGraphql: admin?.graphql ?? null,
      });
    }

    return new Response(null, { status: 200 });
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("[Webhook Error orders/cancelled]:", err.message || err);
    return new Response(null, { status: 200 });
  }
};
