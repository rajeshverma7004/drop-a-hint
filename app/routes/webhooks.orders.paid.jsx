import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { processOrderReferral } from "../services/referral.server";

/**
 * POST /webhooks/orders/paid
 *
 * Fired by Shopify when payment is confirmed for an order.
 * Triggers referral payment confirmation and reward issuance to Customer A.
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

    // Deduplicate webhook execution if the exact same webhookId was already processed
    if (webhookId && webhookId !== "(header missing)") {
      try {
        const existingWebhook = await prisma.processedWebhook.findUnique({
          where: { id: webhookId },
        });
        if (existingWebhook) {
          console.log(`[WEBHOOK] ⚠️ Duplicate webhook ${webhookId} already processed on ${existingWebhook.createdAt.toISOString()}. Idempotent skip.`);
          console.log(`======================================================================\n`);
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
        console.warn(`[ORDER-PAID] Could not obtain unauthenticated admin client for ${shop}:`, err.message);
      }
    }

    if (payload) {
      const result = await processOrderReferral({
        shop,
        order: payload,
        adminGraphql,
      });

      if (result) {
        console.log(`[ORDER-PAID] ✅ Referral #${result.id} processed successfully! Status: ${result.orderStatus}, Reward: ${result.rewardStatus}`);
      } else {
        console.log(`[ORDER-PAID] ℹ️ No matching referral found for order #${payload?.order_number || payload?.id}`);
      }
    }
    console.log(`======================================================================\n`);

    return new Response(null, { status: 200 });
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("[Webhook Error orders/paid]:", err.message || err);
    return new Response(null, { status: 200 }); // Always 200 to stop retry storms
  }
};
