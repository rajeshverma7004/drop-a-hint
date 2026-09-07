/**
 * Programmatically ensures that mandatory Shopify Webhook subscriptions
 * (ORDERS_PAID, ORDERS_CREATE, ORDERS_CANCELLED) are registered on the shop.
 */
export async function ensureWebhookSubscriptions({ shop, adminGraphql }) {
  if (!adminGraphql || !shop) {
    console.warn("[WEBHOOK-SYNC] ⚠️ Cannot sync webhooks: missing admin client or shop");
    return { success: false, error: "Missing admin client or shop" };
  }

  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  if (!appUrl || appUrl.includes("localhost") || appUrl.includes("example.com")) {
    console.warn(`[WEBHOOK-SYNC] ℹ️ App URL is '${appUrl}'. Webhook registration requires a public HTTPS URL.`);
  }

  try {
    // 1. Query existing subscriptions
    const query = `#graphql
      query getWebhookSubscriptions {
        webhookSubscriptions(first: 25) {
          edges {
            node {
              id
              topic
              endpoint {
                __typename
                ... on WebhookHttpEndpoint {
                  callbackUrl
                }
              }
            }
          }
        }
      }
    `;

    const res = await adminGraphql(query);
    const data = await res.json();
    const existingEdges = data?.data?.webhookSubscriptions?.edges || [];
    const existingSubscriptions = existingEdges.map((e) => ({
      id: e.node.id,
      topic: e.node.topic,
      callbackUrl: e.node.endpoint?.callbackUrl || "",
    }));

    console.log(`[WEBHOOK-SYNC] Existing webhooks for ${shop}:`, existingSubscriptions.map((s) => `${s.topic} -> ${s.callbackUrl}`));

    const requiredTopics = [
      { topic: "ORDERS_PAID", subpath: "orders/paid" },
      { topic: "ORDERS_CREATE", subpath: "orders/create" },
      { topic: "ORDERS_CANCELLED", subpath: "orders/cancelled" },
    ];

    const results = [];

    for (const req of requiredTopics) {
      const expectedCallbackUrl = `${appUrl}/webhooks/${req.subpath}`;
      const existing = existingSubscriptions.find((s) => s.topic === req.topic);

      if (existing && existing.callbackUrl === expectedCallbackUrl) {
        results.push({ topic: req.topic, status: "active", id: existing.id, callbackUrl: existing.callbackUrl });
        continue;
      }

      // If existing subscription has an outdated callback URL, delete it first
      if (existing && existing.callbackUrl !== expectedCallbackUrl) {
        console.log(`[WEBHOOK-SYNC] Updating outdated webhook ${req.topic} (${existing.callbackUrl} -> ${expectedCallbackUrl})`);
        try {
          const delMutation = `#graphql
            mutation webhookSubscriptionDelete($id: ID!) {
              webhookSubscriptionDelete(id: $id) {
                deletedWebhookSubscriptionId
              }
            }
          `;
          await adminGraphql(delMutation, { variables: { id: existing.id } });
        } catch (delErr) {
          console.warn("[WEBHOOK-SYNC] Warning deleting old webhook:", delErr.message);
        }
      }

      // Create new subscription
      console.log(`[WEBHOOK-SYNC] Creating webhook subscription ${req.topic} -> ${expectedCallbackUrl}`);
      const createMutation = `#graphql
        mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
            userErrors {
              field
              message
            }
            webhookSubscription {
              id
              topic
              endpoint {
                __typename
                ... on WebhookHttpEndpoint {
                  callbackUrl
                }
              }
            }
          }
        }
      `;

      const createRes = await adminGraphql(createMutation, {
        variables: {
          topic: req.topic,
          webhookSubscription: {
            callbackUrl: expectedCallbackUrl,
            format: "JSON",
          },
        },
      });

      const createData = await createRes.json();
      const userErrors = createData?.data?.webhookSubscriptionCreate?.userErrors || [];
      if (userErrors.length > 0) {
        const errStr = userErrors.map((u) => `${u.field}: ${u.message}`).join(", ");
        console.error(`[WEBHOOK-SYNC] ❌ Error registering ${req.topic}:`, errStr);
        results.push({ topic: req.topic, status: "error", error: errStr });
      } else {
        const sub = createData?.data?.webhookSubscriptionCreate?.webhookSubscription;
        console.log(`[WEBHOOK-SYNC] ✅ Successfully registered ${req.topic} (ID: ${sub?.id})`);
        results.push({ topic: req.topic, status: "registered", id: sub?.id, callbackUrl: expectedCallbackUrl });
      }
    }

    return { success: true, subscriptions: results };
  } catch (err) {
    console.error("[WEBHOOK-SYNC] ❌ Error syncing webhook subscriptions:", err.message || err);
    return { success: false, error: err.message || String(err) };
  }
}
