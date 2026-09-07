import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  createReferral,
  processOrderReferral,
  validateCouponCode,
} from "../app/services/referral.server.js";

const prisma = new PrismaClient();
const TEST_SHOP = "test-coupon-validation.myshopify.com";

test("Coupon Code Checkout Validation Test Suite", async (t) => {
  let testReferralId = null;
  let testDiscountCode = null;

  t.after(async () => {
    if (testReferralId) {
      await prisma.rewardIssuanceLog.deleteMany({ where: { referralId: testReferralId } });
      await prisma.referral.deleteMany({ where: { id: testReferralId } });
    }
    await prisma.rewardIssuanceLog.deleteMany({ where: { shop: TEST_SHOP } });
    await prisma.referral.deleteMany({ where: { shop: TEST_SHOP } });
    await prisma.$disconnect();
  });

  await t.test("1. Third-party discount codes are not flagged as app codes", async () => {
    const thirdPartyCodes = ["SUMMERSALE20", "WELCOME10", "BLACKFRIDAY", "REF-UNKNOWN-9999"];

    for (const code of thirdPartyCodes) {
      const result = await validateCouponCode({
        shop: TEST_SHOP,
        code,
      });

      assert.equal(result.isAppCode, false, `Code ${code} must NOT be flagged as an app code`);
      assert.equal(result.isUsed, false, `Code ${code} must NOT be marked as used`);
      assert.equal(result.valid, false);
      assert.equal(result.error, "Invalid or non-existent coupon code");
    }
  });

  await t.test("2. Newly issued App Coupon is valid and unused", async () => {
    // Step 2a: Create referral
    const friendEmail = `friend-${Date.now()}@example.com`;
    const { referral } = await createReferral({
      shop: TEST_SHOP,
      senderName: "Alice Referrer",
      senderEmail: "alice@example.com",
      receiverName: "Bob Friend",
      receiverEmail: friendEmail,
      productUrl: "https://example.com/products/test",
      productId: "123456",
      productTitle: "Test Product",
    });

    testReferralId = referral.id;

    // Step 2b: Process paid order to issue reward coupon
    const mockAdminGraphql = async (query, { variables }) => {
      const code = variables?.basicCodeDiscount?.code || "REF-ALICE-ABCD";
      return {
        json: async () => ({
          data: {
            discountCodeBasicCreate: {
              codeDiscountNode: {
                id: "gid://shopify/DiscountCodeNode/112233",
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
      id: "991001",
      order_number: "1001",
      name: "#1001",
      email: friendEmail,
      financial_status: "paid",
      total_price: "49.99",
      note_attributes: [{ name: "dah_ref", value: referral.token }],
      line_items: [{ id: "li_1", product_id: "123456", title: "Test Product" }],
    };

    const rewardedRef = await processOrderReferral({
      shop: TEST_SHOP,
      order: paidOrder,
      adminGraphql: mockAdminGraphql,
    });

    assert.ok(rewardedRef.discountCode, "Discount code must be created");
    testDiscountCode = rewardedRef.discountCode;

    // Step 2c: Validate the newly created coupon code
    const validationResult = await validateCouponCode({
      shop: TEST_SHOP,
      code: testDiscountCode,
    });

    assert.equal(validationResult.valid, true, "New coupon code must be valid");
    assert.equal(validationResult.isAppCode, true, "Must be identified as an App Code");
    assert.equal(validationResult.isUsed, false, "Must NOT be marked as used yet");
    assert.equal(validationResult.referral.discountCode, testDiscountCode);
  });

  await t.test("3. Redeemed App Coupon reports used state", async () => {
    assert.ok(testDiscountCode, "Test discount code must exist from previous step");

    // Redeem coupon in a new purchase
    const redeemingOrder = {
      id: "992002",
      order_number: "2002",
      name: "#2002",
      email: "alice@example.com",
      financial_status: "paid",
      total_price: "40.00",
      discount_codes: [{ code: testDiscountCode, amount: "7.50" }],
      line_items: [{ id: "li_2", product_id: "999", title: "Another Product" }],
    };

    await processOrderReferral({
      shop: TEST_SHOP,
      order: redeemingOrder,
      adminGraphql: null,
    });

    // Check DB state
    const refInDb = await prisma.referral.findUnique({ where: { id: testReferralId } });
    assert.equal(refInDb.orderStatus, "Reward Redeemed");
    assert.equal(refInDb.rewardStatus, "Redeemed");
    assert.equal(refInDb.usedCount, 1);

    // Validate coupon code after redemption
    const usedValidationResult = await validateCouponCode({
      shop: TEST_SHOP,
      code: testDiscountCode,
    });

    assert.equal(usedValidationResult.valid, false, "Redeemed coupon must NOT be valid");
    assert.equal(usedValidationResult.isAppCode, true, "Must be identified as an App Code");
    assert.equal(usedValidationResult.isUsed, true, "Must be flagged as isUsed=true");
    assert.equal(
      usedValidationResult.error,
      "Coupon code has already been redeemed",
      "Must return error message for redeemed coupon"
    );
  });

  await t.test("4. Email verification with validateCouponCode", async () => {
    // If customerEmail is passed, it should verify ownership
    const validEmailResult = await validateCouponCode({
      shop: TEST_SHOP,
      code: testDiscountCode,
      customerEmail: "alice@example.com",
    });
    // Even if used, isUsed is true and error returned
    assert.equal(validEmailResult.error, "Coupon code has already been redeemed");

    // If unused coupon has wrong email
    const wrongEmailRef = await prisma.referral.create({
      data: {
        shop: TEST_SHOP,
        senderName: "Other User",
        senderEmail: "other@example.com",
        receiverName: "Friend",
        receiverEmail: "friend@example.com",
        productUrl: "https://example.com",
        discountCode: "REF-OTHER-1234",
        rewardStatus: "Rewarded",
        orderStatus: "Paid",
        rewardIssued: true,
      },
    });

    const mismatchResult = await validateCouponCode({
      shop: TEST_SHOP,
      code: "REF-OTHER-1234",
      customerEmail: "wrong@example.com",
    });
    assert.equal(mismatchResult.error, "This coupon code belongs to another customer account");
    assert.equal(mismatchResult.isAppCode, true);

    await prisma.referral.delete({ where: { id: wrongEmailRef.id } });
  });

  await t.test("5. Test complete checkout flow matrix for all 4 discount cases", async () => {
    // Case 1: Valid Coupon Code app discount
    const validAppRef = await prisma.referral.create({
      data: {
        shop: TEST_SHOP,
        senderName: "User Valid",
        senderEmail: "valid@example.com",
        receiverName: "Friend Valid",
        receiverEmail: "friendvalid@example.com",
        productUrl: "https://example.com",
        discountCode: "REF-VALID-APP1",
        rewardStatus: "Rewarded",
        orderStatus: "Paid",
        rewardIssued: true,
        usedCount: 0,
      },
    });

    const resValid = await validateCouponCode({
      shop: TEST_SHOP,
      code: "REF-VALID-APP1",
    });
    assert.equal(resValid.valid, true, "Case 1: Valid app discount must be valid");
    assert.equal(resValid.isAppCode, true, "Case 1: Must be an app code");
    assert.equal(resValid.isUsed, false, "Case 1: Must not be marked as used");

    // Case 2: Coupon Code app discount that reached its usage limit
    const usedAppRef = await prisma.referral.create({
      data: {
        shop: TEST_SHOP,
        senderName: "User Limit",
        senderEmail: "limit@example.com",
        receiverName: "Friend Limit",
        receiverEmail: "friendlimit@example.com",
        productUrl: "https://example.com",
        discountCode: "REF-LIMIT-APP2",
        rewardStatus: "Redeemed",
        orderStatus: "Reward Redeemed",
        rewardIssued: true,
        usedCount: 1,
        redeemedAt: new Date(),
      },
    });

    const resLimit = await validateCouponCode({
      shop: TEST_SHOP,
      code: "REF-LIMIT-APP2",
    });
    assert.equal(resLimit.valid, false, "Case 2: Used app discount must be invalid");
    assert.equal(resLimit.isAppCode, true, "Case 2: Must be identified as an app code");
    assert.equal(resLimit.isUsed, true, "Case 2: Must be marked as used");
    assert.equal(
      resLimit.error,
      "Coupon code has already been redeemed",
      "Case 2: Must return redemption error"
    );

    // Case 3: Invalid discount code (random/non-existent)
    const resInvalid = await validateCouponCode({
      shop: TEST_SHOP,
      code: "NONEXISTENT999",
    });
    assert.equal(resInvalid.valid, false, "Case 3: Invalid code is not valid");
    assert.equal(resInvalid.isAppCode, false, "Case 3: Must NOT be an app code");
    assert.equal(resInvalid.error, "Invalid or non-existent coupon code");

    // Case 4: Expired/ineligible discount code (third party / Shopify native)
    const resExpired = await validateCouponCode({
      shop: TEST_SHOP,
      code: "EXPIRED_SUMMER_2023",
    });
    assert.equal(resExpired.valid, false, "Case 4: Expired code is not valid");
    assert.equal(resExpired.isAppCode, false, "Case 4: Must NOT be an app code");
    assert.equal(resExpired.error, "Invalid or non-existent coupon code");

    // Cleanup
    await prisma.referral.deleteMany({
      where: { id: { in: [validAppRef.id, usedAppRef.id] } },
    });
  });
});
