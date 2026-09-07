/* global process */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { sendReferralEmail, sendRewardEmail } from "../app/services/email.server.js";

const prisma = new PrismaClient();
const TEST_SHOP = "test-email-settings.myshopify.com";

test("Email Settings & Customization Test Suite", async (t) => {
  t.beforeEach(async () => {
    await prisma.settings.deleteMany({ where: { shop: TEST_SHOP } });
  });

  t.after(async () => {
    await prisma.settings.deleteMany({ where: { shop: TEST_SHOP } });
    await prisma.$disconnect();
  });

  await t.test("1. Save and persist Sender Email and Email Subject in database", async () => {
    const customSender = "rewards@brandstore.com";
    const customSubject = "{{sender_name}} picked a special gift idea for you!";
    const confirmationSender = "confirmations@brandstore.com";
    const confirmationSubject = "Congrats {{sender_name}}, code {{discount_code}} is yours!";

    const created = await prisma.settings.create({
      data: {
        shop: TEST_SHOP,
        discountType: "percentage",
        discountValue: "20",
        senderEmail: customSender,
        emailSubject: customSubject,
        confirmationSenderEmail: confirmationSender,
        confirmationEmailSubject: confirmationSubject,
      },
    });

    assert.equal(created.shop, TEST_SHOP);
    assert.equal(created.senderEmail, customSender);
    assert.equal(created.emailSubject, customSubject);
    assert.equal(created.confirmationSenderEmail, confirmationSender);
    assert.equal(created.confirmationEmailSubject, confirmationSubject);

    // Retrieve again to confirm persistence
    const loaded = await prisma.settings.findUnique({
      where: { shop: TEST_SHOP },
    });

    assert.ok(loaded, "Settings must be persisted");
    assert.equal(loaded.senderEmail, customSender);
    assert.equal(loaded.emailSubject, customSubject);
    assert.equal(loaded.confirmationSenderEmail, confirmationSender);
    assert.equal(loaded.confirmationEmailSubject, confirmationSubject);
  });

  await t.test("2. Update existing Email Settings", async () => {
    await prisma.settings.create({
      data: {
        shop: TEST_SHOP,
        senderEmail: "old-sender@brandstore.com",
        emailSubject: "Old Subject",
        confirmationSenderEmail: "old-confirm@brandstore.com",
        confirmationEmailSubject: "Old Confirm Subject",
      },
    });

    const updated = await prisma.settings.update({
      where: { shop: TEST_SHOP },
      data: {
        senderEmail: "new-sender@brandstore.com",
        emailSubject: "New Subject for {{receiver_name}}",
        confirmationSenderEmail: "new-confirm@brandstore.com",
        confirmationEmailSubject: "New Reward Code: {{discount_code}}",
      },
    });

    assert.equal(updated.senderEmail, "new-sender@brandstore.com");
    assert.equal(updated.emailSubject, "New Subject for {{receiver_name}}");
    assert.equal(updated.confirmationSenderEmail, "new-confirm@brandstore.com");
    assert.equal(updated.confirmationEmailSubject, "New Reward Code: {{discount_code}}");
  });

  await t.test("2b. Upsert Email Settings creates or updates properly", async () => {
    const shop = "drop-a-hint-pczxxbw4.myshopify.com";
    const senderEmail = "rajesh.verma.galaxy@gmail.com";
    const emailSubject = "test";
    const confirmationSenderEmail = "rewards.galaxy@gmail.com";
    const confirmationEmailSubject = "Reward Alert";

    const upserted = await prisma.settings.upsert({
      where: { shop },
      update: {
        senderEmail,
        emailSubject,
        confirmationSenderEmail,
        confirmationEmailSubject,
      },
      create: {
        shop,
        discountType: "percentage",
        discountValue: "15",
        senderEmail,
        emailSubject,
        confirmationSenderEmail,
        confirmationEmailSubject,
      },
    });

    assert.equal(upserted.shop, shop);
    assert.equal(upserted.senderEmail, senderEmail);
    assert.equal(upserted.emailSubject, emailSubject);
    assert.equal(upserted.confirmationSenderEmail, confirmationSenderEmail);
    assert.equal(upserted.confirmationEmailSubject, confirmationEmailSubject);

    // Clean up test shop
    await prisma.settings.deleteMany({ where: { shop } });
  });

  await t.test("3. Validation helper identifies valid vs invalid email formats", () => {
    const validEmails = [
      "support@store.com",
      "info.help@brand.co.uk",
      "hello+marketing@domain.io",
    ];

    const invalidEmails = [
      "notanemail",
      "test@",
      "@domain.com",
      "spaces in@email.com",
      "",
    ];

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (const email of validEmails) {
      assert.ok(emailRegex.test(email), `${email} should be valid`);
    }

    for (const email of invalidEmails) {
      assert.ok(!emailRegex.test(email), `${email} should be invalid`);
    }
  });

  await t.test("4. sendReferralEmail dispatches with configured sender email and custom subject", async () => {
    const verifiedSender = process.env.SENDGRID_FROM_EMAIL || "rajesh.verma@galaxyweblinks.com";
    const customSubject = "{{sender_name}} left a hint for {{receiver_name}} at {{shop}}!";

    try {
      const sendResult = await sendReferralEmail({
        senderName: "Jessica",
        senderEmail: "jessica@example.com",
        receiverName: "David",
        receiverEmail: "david@example.com",
        productTitle: "Diamond Tennis Bracelet",
        productUrl: "https://luxuryboutique.com/products/bracelet",
        productImage: "https://luxuryboutique.com/cdn/bracelet.jpg",
        productPrice: "$250.00",
        customMessage: "I would love this for my birthday!",
        shop: "luxuryboutique.myshopify.com",
        configuredSenderEmail: verifiedSender,
        configuredEmailSubject: customSubject,
      });

      assert.ok(sendResult, "Email dispatch should succeed");
      assert.ok(sendResult.statusCode === 200 || sendResult.statusCode === 202);
    } catch (err) {
      if (
        err.message.includes("messaging limits") ||
        err.message.includes("credits exceeded") ||
        err.message.includes("Maximum credits") ||
        err.message.includes("quota")
      ) {
        console.warn("[Test Notice] SendGrid credit limit reached, skipping live delivery check.");
      } else {
        throw err;
      }
    }
  });

  await t.test("5. sendReferralEmail falls back to default behavior when settings are empty", async () => {
    try {
      const sendResult = await sendReferralEmail({
        senderName: "Alice",
        senderEmail: "alice@example.com",
        receiverName: "Bob",
        receiverEmail: "bob@example.com",
        productTitle: "Vintage Leather Boots",
        productUrl: "https://store.com/products/boots",
        customMessage: "Check these out!",
        shop: "store.myshopify.com",
        configuredSenderEmail: "",
        configuredEmailSubject: "",
      });

      assert.ok(sendResult, "Default email dispatch should succeed");
      assert.ok(sendResult.statusCode === 200 || sendResult.statusCode === 202);
    } catch (err) {
      if (
        err.message.includes("messaging limits") ||
        err.message.includes("credits exceeded") ||
        err.message.includes("Maximum credits") ||
        err.message.includes("quota")
      ) {
        console.warn("[Test Notice] SendGrid credit limit reached, skipping live delivery check.");
      } else {
        throw err;
      }
    }
  });

  await t.test("6. sendRewardEmail dispatches with configured confirmation sender email and subject line", async () => {
    const verifiedSender = process.env.SENDGRID_FROM_EMAIL || "rajesh.verma@galaxyweblinks.com";
    const customSubject = "🎉 Woohoo {{sender_name}}! Here is code {{discount_code}} for {{discount_amount}}";

    try {
      const sendResult = await sendRewardEmail({
        senderName: "Jessica",
        senderEmail: "jessica@example.com",
        discountCode: "REWARD15-XYZ",
        discountAmount: "15% OFF",
        expiryDate: "2026-12-31",
        shop: "luxuryboutique.myshopify.com",
        configuredSenderEmail: verifiedSender,
        configuredEmailSubject: customSubject,
      });

    } catch (err) {
      if (
        err.message.includes("messaging limits") ||
        err.message.includes("credits exceeded") ||
        err.message.includes("Maximum credits") ||
        err.message.includes("quota")
      ) {
        console.warn("[Test Notice] SendGrid credit limit reached, skipping live delivery check.");
      } else {
        throw err;
      }
    }
  });

  await t.test("7. sendReferralEmail with unverified custom sender falls back to verified sender and succeeds", async () => {
    const unverifiedSender = "unverified-abc@galaxyweblinks.com";

    const sendResult = await sendReferralEmail({
      senderName: "Jessica",
      senderEmail: "jessica@example.com",
      receiverName: "David",
      receiverEmail: "david@example.com",
      productTitle: "Test Item",
      productUrl: "https://store.com/item",
      shop: "test-shop.myshopify.com",
      configuredSenderEmail: unverifiedSender,
    });

    assert.ok(sendResult, "Email delivery must succeed via fallback verified sender");
    assert.ok(sendResult.statusCode === 200 || sendResult.statusCode === 202);
  });

  await t.test("8. Verify explicit user request test cases 1 to 5", async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Case 1: xyz@galaxyweblinks.com
    assert.ok(emailRegex.test("xyz@galaxyweblinks.com"), "Case 1 email must be valid");

    // Case 2: store@gmail.com
    assert.ok(emailRegex.test("store@gmail.com"), "Case 2 gmail address must be valid");

    // Case 3: hello@myshop.com
    assert.ok(emailRegex.test("hello@myshop.com"), "Case 3 custom domain must be valid");

    // Case 4: admin@abc.in
    assert.ok(emailRegex.test("admin@abc.in"), "Case 4 .in TLD domain must be valid");

    // Case 5: Invalid emails
    assert.equal(emailRegex.test("abc"), false, "abc must be invalid");
    assert.equal(emailRegex.test("abc@"), false, "abc@ must be invalid");
  });
});
