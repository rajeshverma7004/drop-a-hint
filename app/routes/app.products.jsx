/* global process */
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Helper: replaces the removed json() helper from @react-router/node
function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

// Reference demo products matching specification
const DEMO_PRODUCTS = [
  {
    id: "gid://shopify/Product/9050414776474",
    title: "The Collection Snowboard: Oxygen",
    image: "https://cdn.shopify.com/s/files/1/0762/8419/9066/files/Main_d624f226-0a89-4fe1-b333-0d1548b43c06.jpg?v=1784645002",
    variants: [{ id: "gid://shopify/ProductVariant/4001", title: "Default Title", sku: "SKU-001", price: "299.00" }],
  },
  {
    id: "gid://shopify/Product/9050414678170",
    title: "The Collection Snowboard: Hydrogen",
    image: "https://cdn.shopify.com/s/files/1/0762/8419/9066/files/Main_0a40b01b-5021-48c1-80d1-aa8ab4876d3d.jpg?v=1784645001",
    variants: [{ id: "gid://shopify/ProductVariant/4002", title: "Default Title", sku: "SKU-002", price: "275.00" }],
  },
  {
    id: "gid://shopify/Product/9050414645402",
    title: "The Collection Snowboard: Liquid",
    image: "https://cdn.shopify.com/s/files/1/0762/8419/9066/files/Main_b13e31e0-6394-4d07-8874-29c786b32930.jpg?v=1784645000",
    variants: [{ id: "gid://shopify/ProductVariant/4003", title: "Default Title", sku: "SKU-003", price: "320.00" }],
  },
  {
    id: "gid://shopify/Product/9050414612634",
    title: "The Collection Snowboard: Nitrogen",
    image: "https://cdn.shopify.com/s/files/1/0762/8419/9066/files/Main_1f0e4cf8-51f6-4d76-8809-7d08df04e578.jpg?v=1784644999",
    variants: [{ id: "gid://shopify/ProductVariant/4004", title: "Default Title", sku: "SKU-004", price: "285.00" }],
  },
];

export const loader = async ({ request }) => {
  let admin = null;
  let shop = "demo-shop.myshopify.com";

  if (process.env.SHOPIFY_API_SECRET) {
    try {
      const auth = await authenticate.admin(request);
      admin = auth.admin;
      shop = auth.session.shop;
    } catch {
      // Standalone dev mode
    }
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "search") {
    const query = url.searchParams.get("q") || "";

    // Live Shopify query
    if (admin) {
      try {
        const response = await admin.graphql(
          `#graphql
          query searchProducts($query: String!) {
            products(first: 10, query: $query) {
              edges {
                node {
                  id
                  title
                  featuredImage {
                    url
                    altText
                  }
                  variants(first: 3) {
                    edges {
                      node {
                        id
                        title
                        price
                      }
                    }
                  }
                }
              }
            }
          }`,
          { variables: { query: query ? "title:*" + query + "*" : "" } }
        );

        const data = await response.json();
        const products = data.data.products.edges.map(({ node }) => ({
          id: node.id,
          title: node.title,
          image: node.featuredImage?.url || null,
          variants: node.variants.edges.map(({ node: v }) => ({
            id: v.id,
            title: v.title,
            price: v.price,
          })),
        }));

        return jsonResponse({ products });
      } catch {
        return jsonResponse({ products: [], error: "Failed to fetch products" }, { status: 500 });
      }
    }

    // Demo mode fallback — filter by query
    const filtered = query
      ? DEMO_PRODUCTS.filter((p) =>
          p.title.toLowerCase().includes(query.toLowerCase())
        )
      : DEMO_PRODUCTS;

    return jsonResponse({ products: filtered });
  }

  // Return existing rules for the shop
  if (action === "get_rules") {
    if (!prisma.productDiscountRule) {
      console.error("Prisma model 'productDiscountRule' is not defined. Try restarting the development server.");
      return jsonResponse({ rules: [], error: "Database model is not accessible. Please restart the dev server." }, { status: 500 });
    }
    try {
      const rules = await prisma.productDiscountRule.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
      });
      return jsonResponse({ rules });
    } catch (err) {
      console.error("Error fetching rules:", err);
      return jsonResponse({ rules: [], error: "Database error occurred." }, { status: 500 });
    }
  }

  return jsonResponse({ products: [] });
};

export const action = async ({ request }) => {
  let shop = "demo-shop.myshopify.com";

  if (process.env.SHOPIFY_API_SECRET) {
    try {
      const { session } = await authenticate.admin(request);
      shop = session.shop;
    } catch {
      // Standalone dev mode
    }
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  // Validate Prisma model exists
  if (!prisma.productDiscountRule) {
    console.error("Prisma model 'productDiscountRule' is not defined. Try restarting the development server.");
    return jsonResponse(
      { error: "Database model is not accessible. Please restart the dev server to apply the schema updates." },
      { status: 500 }
    );
  }

  // Save new rule
  if (intent === "save_product_rule") {
    const shopifyProductId = formData.get("shopifyProductId");
    const productTitle = formData.get("productTitle");
    const productImage = formData.get("productImage") || null;
    const discountType = formData.get("discountType");
    const discountValue = formData.get("discountValue");
    const status = formData.get("status") || "Active";

    if (!shopifyProductId || !productTitle || !discountType || !discountValue) {
      return jsonResponse({ error: "All fields are required" }, { status: 400 });
    }
    if (parseFloat(discountValue) <= 0) {
      return jsonResponse({ error: "Discount value must be greater than 0" }, { status: 400 });
    }

    try {
      // Duplicate check
      const existing = await prisma.productDiscountRule.findUnique({
        where: { shop_shopifyProductId: { shop, shopifyProductId } },
      });
      if (existing) {
        return jsonResponse(
          { error: "A discount rule for this product already exists" },
          { status: 409 }
        );
      }

      const rule = await prisma.productDiscountRule.create({
        data: { shop, shopifyProductId, productTitle, productImage, discountType, discountValue, status },
      });

      return jsonResponse({ success: true, rule });
    } catch (err) {
      console.error("Error creating product discount rule:", err);
      return jsonResponse({ error: "Failed to save discount rule. Please check database logs." }, { status: 500 });
    }
  }

  // Update existing rule
  if (intent === "update_product_rule") {
    const id = parseInt(formData.get("id"), 10);
    const discountType = formData.get("discountType");
    const discountValue = formData.get("discountValue");
    const status = formData.get("status");

    if (!id || !discountType || !discountValue) {
      return jsonResponse({ error: "All fields are required" }, { status: 400 });
    }
    if (parseFloat(discountValue) <= 0) {
      return jsonResponse({ error: "Discount value must be greater than 0" }, { status: 400 });
    }

    try {
      const dataToUpdate = { discountType, discountValue };
      if (status) dataToUpdate.status = status;

      const rule = await prisma.productDiscountRule.update({
        where: { id },
        data: dataToUpdate,
      });

      return jsonResponse({ success: true, rule });
    } catch (err) {
      console.error("Error updating product discount rule:", err);
      return jsonResponse({ error: "Failed to update discount rule." }, { status: 500 });
    }
  }

  // Delete rule
  if (intent === "delete_product_rule") {
    const id = parseInt(formData.get("id"), 10);
    if (!id) return jsonResponse({ error: "Invalid ID" }, { status: 400 });

    try {
      await prisma.productDiscountRule.delete({ where: { id } });
      return jsonResponse({ success: true });
    } catch (err) {
      console.error("Error deleting product discount rule:", err);
      return jsonResponse({ error: "Failed to delete discount rule." }, { status: 500 });
    }
  }

  // Toggle status
  if (intent === "toggle_status") {
    const id = parseInt(formData.get("id"), 10);
    const currentStatus = formData.get("currentStatus");
    if (!id) return jsonResponse({ error: "Invalid ID" }, { status: 400 });

    const newStatus = currentStatus === "Active" ? "Draft" : "Active";
    try {
      const rule = await prisma.productDiscountRule.update({
        where: { id },
        data: { status: newStatus },
      });

      return jsonResponse({ success: true, rule });
    } catch (err) {
      console.error("Error toggling product discount rule status:", err);
      return jsonResponse({ error: "Failed to toggle status." }, { status: 500 });
    }
  }

  return jsonResponse({ error: "Invalid intent" }, { status: 400 });
};
