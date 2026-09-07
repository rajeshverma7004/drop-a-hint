import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  createReferral,
  processOrderReferral,
  retryRewardEmail,
} from "../app/services/referral.server.js";

const prisma = new PrismaClient();
const TEST_SHOP = "drop-a-hint-pczxxbw4.myshopify.com";

test("Referral Reward System Concurrency & Idempotency Suite", async (t) => {
  let createdRef = null;
  const friendEmail = `concurrency-test-${Date.now()}@yopmail.com`;
  let mockShopifyDiscountsCreated = 0;
  const mockDiscountCodesCreated = [];

  const mockAdminGraphql = async (query, { variables }) => {
    mockShopifyDiscountsCreated++;
    const code = variables?.basicCodeDiscount?.code || `REF-MOCK-${mockShopifyDiscountsCreated}`;
    mockDiscountCodesCreated.push(code);
    return {
      json: async () => ({
        data: {
          discountCodeBasicCreate: {
            codeDiscountNode: {
              id: `gid://shopify/DiscountCodeNode/${900000 + mockShopifyDiscountsCreated}`,
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

  await t.test("1. Referral Creation", async () => {
    const { referral, token } = await createReferral({
      shop: TEST_SHOP,
      senderName: "Concurrency Tester",
      senderEmail: "rajesh.verma@galaxyweblinks.com",
      receiverName: "Friend B",
      receiverEmail: friendEmail,
      productUrl: "https://drop-a-hint-pczxxbw4.myshopify.com/products/selling-plans-ski-wax",
      productId: "9050414645402",
      productTitle: "Selling Plans Ski Wax",
    });

    assert.ok(referral);
    assert.ok(token && token.startsWith("ref_"));
    assert.equal(referral.rewardIssued, false);
    assert.equal(referral.rewardProcessingState, "PENDING");
    createdRef = referral;
  });

  await t.test("2. Unpaid order (financial_status: pending) does NOT generate discount", async () => {
    const unpaidOrderPayload = {
      id: "777701",
      order_number: "7701",
      name: "#7701",
      email: friendEmail,
      financial_status: "pending",
      total_price: "45.00",
      note_attributes: [{ name: "dah_ref", value: createdRef.token }],
      line_items: [{ id: "666601", product_id: "9050414645402", title: "Selling Plans Ski Wax" }],
    };

    const res = await processOrderReferral({
      shop: TEST_SHOP,
      order: unpaidOrderPayload,
      adminGraphql: mockAdminGraphql,
    });

    assert.ok(res);
    assert.equal(res.orderStatus, "Purchased");
    assert.equal(res.rewardIssued, false);
    assert.equal(res.discountCode, null);
    assert.equal(mockShopifyDiscountsCreated, 0, "No discount code should be generated on unpaid orders");
  });

  await t.test("3. Concurrent orders/paid webhooks arriving simultaneously produce EXACTLY ONE reward", async () => {
    const paidOrderPayload = {
      id: "777701",
      order_number: "7701",
      name: "#7701",
      email: friendEmail,
      financial_status: "paid",
      total_price: "45.00",
      note_attributes: [{ name: "dah_ref", value: createdRef.token }],
      line_items: [{ id: "666601", product_id: "9050414645402", title: "Selling Plans Ski Wax" }],
    };

    // Fire 5 concurrent webhook executions at the EXACT same millisecond
    const concurrentExecutions = await Promise.all([
      processOrderReferral({ shop: TEST_SHOP, order: paidOrderPayload, adminGraphql: mockAdminGraphql, allowRewardIssuance: true }),
      processOrderReferral({ shop: TEST_SHOP, order: paidOrderPayload, adminGraphql: mockAdminGraphql, allowRewardIssuance: true }),
      processOrderReferral({ shop: TEST_SHOP, order: paidOrderPayload, adminGraphql: mockAdminGraphql, allowRewardIssuance: true }),
      processOrderReferral({ shop: TEST_SHOP, order: paidOrderPayload, adminGraphql: mockAdminGraphql, allowRewardIssuance: true }),
      processOrderReferral({ shop: TEST_SHOP, order: paidOrderPayload, adminGraphql: mockAdminGraphql, allowRewardIssuance: true }),
    ]);

    // All returned results must resolve to the same canonical discount code
    const canonicalCode = concurrentExecutions[0].discountCode;
    assert.ok(canonicalCode, "A discount code must be returned");
    for (const exec of concurrentExecutions) {
      assert.equal(exec.discountCode, canonicalCode, "All concurrent executions must share the exact same coupon code");
      assert.equal(exec.rewardIssued, true);
    }

    // Exactly 1 Shopify discount mutation must have been invoked
    assert.equal(mockShopifyDiscountsCreated, 1, "Shopify discount creation must only be called ONCE despite 5 concurrent requests");

    // Check DB state
    const refInDb = await prisma.referral.findUnique({ where: { id: createdRef.id } });
    assert.equal(refInDb.rewardIssued, true);
    assert.equal(refInDb.discountCode, canonicalCode);
    assert.equal(typeof refInDb.rewardEmailSent, "boolean");

    // Check RewardIssuanceLog uniqueness
    const rewardLogs = await prisma.rewardIssuanceLog.findMany({ where: { referralId: createdRef.id } });
    assert.equal(rewardLogs.length, 1, "Exactly one RewardIssuanceLog record must exist in the database");
  });

  await t.test("4. Subsequent duplicate webhook replay returns existing reward (Zero new discounts)", async () => {
    const replayOrderPayload = {
      id: "777701",
      order_number: "7701",
      name: "#7701",
      email: friendEmail,
      financial_status: "paid",
      total_price: "45.00",
      note_attributes: [{ name: "dah_ref", value: createdRef.token }],
      line_items: [{ id: "666601", product_id: "9050414645402", title: "Selling Plans Ski Wax" }],
    };

    const replayRes = await processOrderReferral({
      shop: TEST_SHOP,
      order: replayOrderPayload,
      adminGraphql: mockAdminGraphql,
      allowRewardIssuance: true,
    });

    assert.equal(replayRes.rewardIssued, true);
    assert.equal(mockShopifyDiscountsCreated, 1, "Zero additional discounts created on replay");
  });

  await t.test("5. Retry Reward Email sends the SAME coupon code without generating a new one", async () => {
    const retryRes = await retryRewardEmail({
      shop: TEST_SHOP,
      referralId: createdRef.id,
    });

    assert.ok(retryRes, "Retry response must be returned");
    assert.equal(retryRes.referral.discountCode, createdRef.discountCode || mockDiscountCodesCreated[0]);
    assert.equal(mockShopifyDiscountsCreated, 1, "Zero additional discounts created on email retry");
  });

  await t.test("6. Multiple legitimate referrals from same Customer A receive distinct valid coupons", async () => {
    // Referrer A refers Friend C
    const friendC_Email = `friend-c-${Date.now()}@yopmail.com`;
    const { referral: refC } = await createReferral({
      shop: TEST_SHOP,
      senderName: "Concurrency Tester",
      senderEmail: "rajesh.verma@galaxyweblinks.com",
      receiverName: "Friend C",
      receiverEmail: friendC_Email,
      productUrl: "https://drop-a-hint-pczxxbw4.myshopify.com/products/selling-plans-ski-wax",
      productId: "9050414645402",
      productTitle: "Selling Plans Ski Wax",
    });

    const paidOrderC = {
      id: "777702",
      order_number: "7702",
      name: "#7702",
      email: friendC_Email,
      financial_status: "paid",
      total_price: "60.00",
      note_attributes: [{ name: "dah_ref", value: refC.token }],
      line_items: [{ id: "666602", product_id: "9050414645402", title: "Selling Plans Ski Wax" }],
    };

    const resC = await processOrderReferral({
      shop: TEST_SHOP,
      order: paidOrderC,
      adminGraphql: mockAdminGraphql,
      allowRewardIssuance: true,
    });

    assert.ok(resC.discountCode);
    assert.notEqual(resC.discountCode, mockDiscountCodesCreated[0], "Friend C referral must get its own unique coupon");
    assert.equal(mockShopifyDiscountsCreated, 2, "Second referral must legitimately create a second discount");

    // Cleanup refC
    await prisma.rewardIssuanceLog.deleteMany({ where: { referralId: refC.id } });
    await prisma.referral.delete({ where: { id: refC.id } });
  });

  // Cleanup main test referral
  if (createdRef?.id) {
    await prisma.rewardIssuanceLog.deleteMany({ where: { referralId: createdRef.id } });
    await prisma.referral.delete({ where: { id: createdRef.id } });
  }
  await prisma.$disconnect();
});
