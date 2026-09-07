import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  createReferral,
  processOrderReferral,
} from "../app/services/referral.server.js";

const prisma = new PrismaClient();
const TEST_SHOP = "drop-a-hint-pczxxbw4.myshopify.com";

test("End-to-End Referral Flow Verification", async (t) => {
  let createdRef = null;
  const friendEmail = `test-friend-${Date.now()}@yopmail.com`;
  const orderId = `999${Date.now().toString().slice(-4)}`;
  const orderNumber = `99${Date.now().toString().slice(-2)}`;

  await t.test("Step 1: Customer A creates referral for Product", async () => {
    const { referral, token } = await createReferral({
      shop: TEST_SHOP,
      senderName: "Customer A",
      senderEmail: "rajesh.verma@galaxyweblinks.com",
      receiverName: "Friend B",
      receiverEmail: friendEmail,
      productUrl: "https://drop-a-hint-pczxxbw4.myshopify.com/products/selling-plans-ski-wax",
      productId: "9050414645402",
      productTitle: "Selling Plans Ski Wax",
    });

    assert.ok(referral, "Referral must be created");
    assert.ok(token.startsWith("ref_"), "Token must start with ref_");
    assert.equal(referral.orderStatus, "Pending");
    assert.equal(referral.rewardStatus, "Not Rewarded");
    assert.ok(referral.rewardValue, "Must have snapshot reward value");

    createdRef = referral;
  });

  await t.test("Step 2: Friend B places unpaid order (payment pending)", async () => {
    const unpaidOrder = {
      id: orderId,
      order_number: orderNumber,
      name: `#${orderNumber}`,
      email: friendEmail,
      financial_status: "pending",
      total_price: "32.95",
      note_attributes: [{ name: "dah_ref", value: createdRef.token }],
      line_items: [
        {
          id: "888801",
          product_id: "9050414645402",
          title: "Selling Plans Ski Wax",
          properties: [{ name: "_dah_ref", value: createdRef.token }],
        },
      ],
    };

    const result = await processOrderReferral({
      shop: TEST_SHOP,
      order: unpaidOrder,
      adminGraphql: null,
    });

    assert.ok(result, "Result should be returned");
    assert.equal(result.orderStatus, "Purchased");
    assert.equal(result.rewardStatus, "Pending Payment");
    assert.equal(result.rewardIssued, false);
    assert.equal(result.discountCode, null);
  });

  await t.test("Step 3: Shopify confirms payment (orders/paid fires)", async () => {
    const mockAdminGraphql = async (query, { variables }) => {
      const code = variables?.basicCodeDiscount?.code || "REF-TEST-AUTO";
      return {
        json: async () => ({
          data: {
            discountCodeBasicCreate: {
              codeDiscountNode: {
                id: "gid://shopify/DiscountCodeNode/999999",
                codeDiscount: {
                  title: `Referral Reward - ${code}`,
                  codes: { nodes: [{ code }] },
                },
              },
              userErrors: [],
            },
          },
        }),
      };
    };

    const paidOrder = {
      id: orderId,
      order_number: orderNumber,
      name: `#${orderNumber}`,
      email: friendEmail,
      financial_status: "paid",
      total_price: "32.95",
      note_attributes: [{ name: "dah_ref", value: createdRef.token }],
      line_items: [
        {
          id: "888801",
          product_id: "9050414645402",
          title: "Selling Plans Ski Wax",
          properties: [{ name: "_dah_ref", value: createdRef.token }],
        },
      ],
    };

    const result = await processOrderReferral({
      shop: TEST_SHOP,
      order: paidOrder,
      adminGraphql: mockAdminGraphql,
    });

    assert.ok(result, "Result should be returned");
    assert.equal(result.orderStatus, "Paid");
    assert.equal(result.rewardStatus, "Rewarded");
    assert.equal(result.rewardIssued, true);
    assert.ok(result.discountCode && result.discountCode.startsWith("REF-"));
    assert.equal(typeof result.rewardEmailSent, "boolean");
  });

  await t.test("Step 4: Webhook idempotency test on duplicate delivery", async () => {
    const paidOrderAgain = {
      id: orderId,
      order_number: orderNumber,
      name: `#${orderNumber}`,
      email: friendEmail,
      financial_status: "paid",
      total_price: "32.95",
      note_attributes: [{ name: "dah_ref", value: createdRef.token }],
      line_items: [
        {
          id: "888801",
          product_id: "9050414645402",
          title: "Selling Plans Ski Wax",
        },
      ],
    };

    const refBefore = await prisma.referral.findUnique({ where: { id: createdRef.id } });
    const duplicateResult = await processOrderReferral({
      shop: TEST_SHOP,
      order: paidOrderAgain,
      adminGraphql: null,
    });

    assert.equal(duplicateResult.discountCode, refBefore.discountCode, "Discount code must remain identical");
    assert.equal(duplicateResult.rewardStatus, "Rewarded");
  });

  await t.test("Step 4b: Admin retries reward email delivery safely", async () => {
    const { retryRewardEmail } = await import("../app/services/referral.server.js");
    const retryResult = await retryRewardEmail({
      shop: TEST_SHOP,
      referralId: createdRef.id,
    });

    assert.ok(retryResult, "Retry result returned");
    assert.equal(typeof retryResult.referral.rewardEmailSent, "boolean");
    assert.equal(retryResult.referral.discountCode, createdRef.discountCode || retryResult.referral.discountCode);
  });

  await t.test("Step 5: Customer A redeems discount code in a new order", async () => {
    const refRecord = await prisma.referral.findUnique({ where: { id: createdRef.id } });
    const redemptionOrderId = `998${Date.now().toString().slice(-4)}`;
    const redemptionOrderNumber = `98${Date.now().toString().slice(-2)}`;
    const redemptionOrder = {
      id: redemptionOrderId,
      order_number: redemptionOrderNumber,
      name: `#${redemptionOrderNumber}`,
      email: "rajesh.verma@galaxyweblinks.com",
      financial_status: "paid",
      total_price: "50.00",
      discount_codes: [{ code: refRecord.discountCode, amount: "7.50" }],
      line_items: [
        {
          id: "888802",
          product_id: "9050414743706",
          title: "The Multi-location Snowboard",
        },
      ],
    };

    await processOrderReferral({
      shop: TEST_SHOP,
      order: redemptionOrder,
      adminGraphql: null,
    });

    const redeemedRef = await prisma.referral.findUnique({ where: { id: createdRef.id } });
    assert.equal(redeemedRef.orderStatus, "Reward Redeemed");
    assert.equal(redeemedRef.rewardStatus, "Redeemed");
    assert.equal(redeemedRef.redeemingOrderNumber, `#${redemptionOrderNumber}`);
    assert.equal(redeemedRef.usedCount, 1);
  });

  // Cleanup test referral
  if (createdRef?.id) {
    await prisma.rewardIssuanceLog.deleteMany({ where: { referralId: createdRef.id } });
    await prisma.referral.delete({ where: { id: createdRef.id } });
  }
  await prisma.$disconnect();
});
