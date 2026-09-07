import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { processOrderReferral } from "../services/referral.server";

/**
 * POST /webhooks/orders/create
 *
 * Fired by Shopify immediately when any order is placed.
 * Connects the order with the referral and initiates tracking.
 * NOTE: Reward code generation and reward emails are strictly gated to orders/paid.
 */
export const action = async ({ request }) => {
  const timestamp = new Date().toISOString();
  const webhookId = request.headers.get("X-Shopify-Webhook-Id") || "(header missing)";
  try {
    const { payload, shop, topic, admin } = await authenticate.webhook(request);

    console.log(`\n==================== [SHOPIFY WEBHOOK: ${topic}] ====================`);
    console.log(`[WEBHOOK] topic=${topic}`);
    console.log(`[WEBHOOK] order id=${payload?.id || "(none)"}`);
    console.log(`[WEBHOOK] webhook received`);
    console.log(`[SHOPIFY WEBHOOK]`);
    console.log(`  shop:        ${shop}`);
    console.log(`  topic:       ${topic}`);
    console.log(`  webhookId:   ${webhookId}`);
    console.log(`  orderId:     ${payload?.id || "(none)"}`);
    console.log(`  receivedAt:  ${timestamp}`);

    if (webhookId && webhookId !== "(header missing)") {
      try {
        const existingWebhook = await prisma.processedWebhook.findUnique({
          where: { id: webhookId },
        });
        if (existingWebhook) {
          console.log(`[WEBHOOK] ⚠️ Duplicate webhook ${webhookId} already processed. Idempotent skip.`);
          console.log(`========================================================================\n`);
          return new Response(null, { status: 200 });
        }
        await prisma.processedWebhook.create({
          data: {
            id: webhookId,
            shop,
            topic,
            orderId: String(payload?.id || ""),
          },
        });
      } catch (whDbErr) {
        console.warn(`[WEBHOOK] ProcessedWebhook notice:`, whDbErr.message);
      }
    }

    let adminGraphql = admin?.graphql ?? null;
    if (!adminGraphql && shop) {
      try {
        const unauth = await unauthenticated.admin(shop);
        adminGraphql = unauth?.admin?.graphql ?? null;
      } catch (err) {
        console.warn(`[ORDER-CREATE] Could not obtain unauthenticated admin client for ${shop}:`, err.message);
      }
    }

    if (payload) {
      const result = await processOrderReferral({
        shop,
        order: payload,
        adminGraphql,
        allowRewardIssuance: true,
      });

      if (result) {
        console.log(`[ORDER-CREATE] ✅ Referral #${result.id} processed! Order Status: ${result.orderStatus}, Reward Status: ${result.rewardStatus}`);
      } else {
        console.log(`[ORDER-CREATE] ℹ️ No matching referral found for order #${payload?.order_number || payload?.id}`);
      }
    }
    console.log(`========================================================================\n`);

    return new Response(null, { status: 200 });
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("[Webhook Error orders/create]:", err.message || err);
    return new Response(null, { status: 200 });
  }
};
