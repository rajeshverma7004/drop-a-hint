import sgMail from "@sendgrid/mail";

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

/**
 * Sanitizes a string value for safe use inside HTML email templates.
 * Prevents XSS by escaping HTML entities.
 */
export function sanitizeInput(str) {
  if (typeof str !== "string") return "";
  return str
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Returns true if the value is a well-formed email address.
 */
export function isValidEmail(email) {
  if (typeof email !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ---------------------------------------------------------------------------
// SendGrid client initialisation
// ---------------------------------------------------------------------------

/**
 * Reads SENDGRID_API_KEY from the environment and configures the client.
 * Throws a descriptive error if the key is absent so issues surface early.
 */
function initSendGrid() {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    throw new Error(
      "[SendGrid] SENDGRID_API_KEY is not set in environment variables. " +
        "Add it to your .env file and restart the server."
    );
  }
  sgMail.setApiKey(apiKey);
}

// ---------------------------------------------------------------------------
// Internal: dispatch a single message through the SendGrid API
// ---------------------------------------------------------------------------

/**
 * Sends one email via SendGrid and returns the API response.
 * Throws on any error so callers can decide how to surface it.
 *
 * @param {{ to, from, replyTo, subject, text, html }} mailOptions
 */
async function dispatch(mailOptions) {
  initSendGrid();

  const apiKey = process.env.SENDGRID_API_KEY || "";
  const maskedKey = apiKey ? `${"•".repeat(Math.max(0, apiKey.length - 4))}${apiKey.slice(-4)}` : "(empty)";

  console.log("[SendGrid] ─────────────────────────────────────────────────");
  console.log(`[SendGrid] API Key    : ${maskedKey}`);
  console.log(`[SendGrid] From       : ${typeof mailOptions.from === "object" ? `${mailOptions.from.name} <${mailOptions.from.email}>` : mailOptions.from}`);
  console.log(`[SendGrid] To         : ${mailOptions.to}`);
  if (mailOptions.replyTo) console.log(`[SendGrid] Reply-To   : ${mailOptions.replyTo}`);
  console.log(`[SendGrid] Subject    : ${mailOptions.subject}`);
  console.log("[SendGrid] ─────────────────────────────────────────────────");

  console.log("[EMAIL] Template generated");
  console.log("[EMAIL] Provider request sent");
  let response;
  try {
    [response] = await sgMail.send(mailOptions);
  } catch (err) {
    const sgErrors = err?.response?.body?.errors;
    let detail = sgErrors?.map((e) => e.message).join("; ") || err.message || String(err);
    const defaultFromEmail = process.env.SENDGRID_FROM_EMAIL || "rajesh.verma@galaxyweblinks.com";
    const currentFromEmail = typeof mailOptions.from === "object" ? mailOptions.from.email : mailOptions.from;

    // If custom sender is unverified in SendGrid, fall back to default verified sender while preserving replyTo
    if (detail.includes("verified Sender Identity") && currentFromEmail !== defaultFromEmail) {
      console.warn(`[SendGrid Warning] Custom sender '${currentFromEmail}' is not verified in SendGrid. Falling back to default verified sender '${defaultFromEmail}' with Reply-To set to '${currentFromEmail}'.`);

      const fallbackMailOptions = {
        ...mailOptions,
        from: typeof mailOptions.from === "object"
          ? { ...mailOptions.from, email: defaultFromEmail }
          : defaultFromEmail,
        replyTo: mailOptions.replyTo || currentFromEmail,
      };

      try {
        [response] = await sgMail.send(fallbackMailOptions);
        console.log(`[SendGrid] ✅ Delivered via fallback verified sender (${defaultFromEmail})`);
      } catch (fallbackErr) {
        const fallbackDetail = fallbackErr?.response?.body?.errors?.map((e) => e.message).join("; ") || fallbackErr.message;
        console.error("[EMAIL] sent=false");
        console.error(`[SendGrid] ❌ Fallback Delivery failed: ${fallbackDetail}`);
        throw new Error(`SendGrid delivery failed: ${fallbackDetail}`);
      }
    } else {
      if (detail.includes("verified Sender Identity")) {
        detail = `The sender email '${currentFromEmail}' is not a verified Sender Identity in SendGrid. Please verify this email address or domain in SendGrid settings.`;
      }

      console.error("[EMAIL] sent=false");
      console.error("[SendGrid] ❌ Delivery failed");
      console.error(`[SendGrid]   HTTP status : ${err?.response?.statusCode ?? "N/A"}`);
      console.error(`[SendGrid]   Detail      : ${detail}`);

      throw new Error(`SendGrid delivery failed: ${detail}`);
    }
  }

  console.log("[EMAIL] Provider response received");
  const statusCode = response?.statusCode;
  const messageId = response?.headers?.["x-message-id"] ?? "N/A";

  if (statusCode === 200 || statusCode === 202) {
    console.log(`[EMAIL] sent=true (HTTP ${statusCode}, message-id: ${messageId})`);
    console.log(`[SendGrid] ✅ Accepted (HTTP ${statusCode}, message-id: ${messageId})`);
    return { statusCode, messageId };
  }

  console.error("[EMAIL] sent=false");
  throw new Error(
    `SendGrid returned unexpected HTTP status ${statusCode} for message to ${mailOptions.to}.`
  );
}

// ---------------------------------------------------------------------------
// HTML template helpers
// ---------------------------------------------------------------------------

function supportTicketHtml({ cleanName, cleanEmail, cleanPhone, cleanShop, cleanSubject, cleanMessage, timestamp }) {
  const phoneRow = cleanPhone
    ? `<div class="row"><div class="lbl">Phone</div><div class="val">${cleanPhone}</div></div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Support Request – Drop A Hint</title>
  <style>
    body{font-family:'Segoe UI',Helvetica,Arial,sans-serif;background:#f4f6f8;margin:0;padding:20px;color:#333}
    .wrap{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.08);border:1px solid #e1e3e5}
    .hdr{background:#008060;padding:24px;text-align:center;color:#fff}
    .hdr h1{margin:0;font-size:22px;font-weight:600}
    .body{padding:30px}
    .row{margin-bottom:20px}
    .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:#6d7175;font-weight:700;margin-bottom:4px}
    .val{font-size:15px;color:#202223;font-weight:500}
    .msg{background:#f9fafb;border-left:4px solid #008060;padding:16px;border-radius:4px;font-size:14px;line-height:1.6;white-space:pre-wrap;margin-top:8px}
    .ftr{background:#f4f6f8;padding:16px;text-align:center;font-size:12px;color:#8c9196;border-top:1px solid #e1e3e5}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hdr"><h1>Drop A Hint &bull; Support Request</h1></div>
    <div class="body">
      <div class="row"><div class="lbl">User Name</div><div class="val">${cleanName}</div></div>
      <div class="row"><div class="lbl">User Email</div><div class="val"><a href="mailto:${cleanEmail}" style="color:#008060;text-decoration:none">${cleanEmail}</a></div></div>
      ${phoneRow}
      <div class="row"><div class="lbl">Shopify Store</div><div class="val">${cleanShop}</div></div>
      <div class="row"><div class="lbl">Subject</div><div class="val">${cleanSubject}</div></div>
      <div class="row"><div class="lbl">Message / Details</div><div class="msg">${cleanMessage}</div></div>
      <div class="row"><div class="lbl">Date & Time</div><div class="val">${timestamp}</div></div>
    </div>
    <div class="ftr">Received via Drop A Hint Shopify App &bull; ${timestamp}</div>
  </div>
</body>
</html>`;
}

function referralHtml({ cleanSenderName, cleanSenderEmail, cleanReceiverName, cleanShop, cleanProductTitle, cleanProductUrl, cleanProductPrice, cleanProductCompareAtPrice, cleanProductImage, cleanCustomMessage }) {
  const imageMarkup = cleanProductImage
    ? `<div style="text-align:center;margin-bottom:20px"><img src="${cleanProductImage}" alt="${cleanProductTitle}" style="max-width:100%;max-height:300px;border-radius:8px;object-fit:contain;box-shadow:0 2px 8px rgba(0,0,0,.1)"></div>`
    : "";

  // Build pricing markup: show compare-at (strikethrough) + sale price when on sale,
  // or just the regular price when no compare-at price exists.
  let priceMarkup = '';
  if (cleanProductPrice) {
    if (cleanProductCompareAtPrice && cleanProductCompareAtPrice !== cleanProductPrice) {
      // Product is on sale — show both prices
      priceMarkup = `
        <div style="margin-bottom:20px;text-align:center">
          <span style="font-size:15px;color:#8c9196;text-decoration:line-through;margin-right:8px">${cleanProductCompareAtPrice}</span>
          <span style="display:inline-block;font-size:22px;font-weight:800;color:#c0392b;background:#fdf3f3;padding:4px 12px;border-radius:4px;border:1px solid #f5c6c6">${cleanProductPrice}</span>
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.8px;color:#c0392b;font-weight:700;margin-top:6px">On Sale</div>
        </div>`;
    } else {
      // Regular price — no compare-at
      priceMarkup = `<div style="font-size:20px;font-weight:700;color:#008060;margin-bottom:20px;text-align:center">${cleanProductPrice}</div>`;
    }
  }

  const msgMarkup = cleanCustomMessage
    ? `<div style="background:#f0f7f5;border-left:4px solid #008060;padding:16px;border-radius:4px;margin-bottom:24px;font-style:italic;color:#202223">&ldquo;${cleanCustomMessage}&rdquo;</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Drop A Hint – Theme Extension Referral</title>
</head>
<body style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4f6f8;margin:0;padding:20px;color:#333">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08);border:1px solid #e1e3e5">
    <div style="background:#008060;padding:24px;text-align:center;color:#fff">
      <h1 style="margin:0;font-size:24px;font-weight:700;letter-spacing:.5px">Drop A Hint &bull; Recommendation</h1>
    </div>
    <div style="padding:32px 28px">
      <p style="font-size:16px;margin-top:0;margin-bottom:16px">Hi <strong>${cleanReceiverName}</strong>,</p>
      <p style="font-size:15px;line-height:1.5;color:#4a4a4a;margin-bottom:20px">
        Your friend <strong>${cleanSenderName}</strong> (<a href="mailto:${cleanSenderEmail}" style="color:#008060;text-decoration:none">${cleanSenderEmail}</a>) invited you to check out this product from <strong>${cleanShop}</strong>!
      </p>
      ${msgMarkup}
      <div style="background:#fafafa;border:1px solid #e5e5e5;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px">
        ${imageMarkup}
        <h2 style="font-size:20px;font-weight:600;color:#202223;margin:0 0 10px 0">${cleanProductTitle}</h2>
        ${priceMarkup}
        <a href="${cleanProductUrl}" target="_blank" style="display:inline-block;background:#008060;color:#fff;text-decoration:none;padding:14px 32px;border-radius:6px;font-weight:bold;font-size:16px;box-shadow:0 2px 6px rgba(0,128,96,.3)">View Product &amp; Refer</a>
      </div>
      <p style="font-size:14px;color:#6d7175;text-align:center;margin-bottom:0">Check it out today for special offers and discounts!</p>
    </div>
    <div style="background:#f4f6f8;padding:20px;text-align:center;font-size:12px;color:#8c9196;border-top:1px solid #e1e3e5">
      Sent via Drop A Hint Theme Extension &bull; ${cleanShop} &bull; ${new Date().getFullYear()}
    </div>
  </div>
</body>
</html>`;
}

function rewardEmailHtml({ cleanSenderName, cleanDiscountCode, cleanDiscountAmount, cleanExpiryDate, cleanShop }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>🎉 Your Referral Was Successful! Here's Your Reward</title>
</head>
<body style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4f6f8;margin:0;padding:20px;color:#333">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08);border:1px solid #e1e3e5">
    <div style="background:#008060;padding:24px;text-align:center;color:#fff">
      <h1 style="margin:0;font-size:24px;font-weight:700;letter-spacing:.5px">🎉 Referral Reward Earned!</h1>
    </div>
    <div style="padding:32px 28px">
      <p style="font-size:16px;margin-top:0;margin-bottom:16px">Hello <strong>${cleanSenderName}</strong>,</p>
      <p style="font-size:15px;line-height:1.5;color:#4a4a4a;margin-bottom:20px">
        Great news! Your friend has successfully purchased the product you referred.
      </p>
      <p style="font-size:15px;line-height:1.5;color:#4a4a4a;margin-bottom:20px">
        As a thank you, we've generated a reward for you.
      </p>

      <div style="background:#f0f7f5;border:2px dashed #008060;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px">
        <div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#6d7175;margin-bottom:8px;font-weight:bold">Discount Code</div>
        <div style="font-size:28px;font-weight:800;color:#008060;letter-spacing:2px;margin-bottom:12px">${cleanDiscountCode}</div>
        <div style="font-size:18px;font-weight:700;color:#202223;margin-bottom:8px">Discount: ${cleanDiscountAmount}</div>
        ${cleanExpiryDate ? `<div style="font-size:14px;color:#6d7175">Valid Until: <strong>${cleanExpiryDate}</strong></div>` : ""}
      </div>

      <p style="font-size:14px;color:#4a4a4a;line-height:1.5;margin-bottom:24px">
        Use this code during checkout to receive your discount on your next purchase!
      </p>

      <div style="text-align:center;margin-bottom:20px">
        <a href="https://${cleanShop}" target="_blank" style="display:inline-block;background:#008060;color:#fff;text-decoration:none;padding:14px 32px;border-radius:6px;font-weight:bold;font-size:16px;box-shadow:0 2px 6px rgba(0,128,96,.3)">Shop Now</a>
      </div>
    </div>
    <div style="background:#f4f6f8;padding:20px;text-align:center;font-size:12px;color:#8c9196;border-top:1px solid #e1e3e5">
      Sent via Drop A Hint App &bull; ${cleanShop} &bull; ${new Date().getFullYear()}
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sends a support-ticket email to the designated support recipient (rajesh.verma@galaxyweblinks.com).
 *
 * @throws {Error} if validation fails, the API key is missing, or SendGrid
 *   rejects the message. Callers should return a 500 response on error.
 */
export async function sendSupportEmail({ name, email, phone, subject, message, shop }) {
  const cleanName    = sanitizeInput(name);
  const cleanEmail   = sanitizeInput(email);
  const cleanPhone   = sanitizeInput(phone);
  const cleanSubject = sanitizeInput(subject);
  const cleanMessage = sanitizeInput(message);
  const cleanShop    = sanitizeInput(shop) || "Unknown Store";

  if (!cleanName)                 throw new Error("User name is required.");
  if (!isValidEmail(cleanEmail))  throw new Error("A valid sender email address is required.");
  if (!cleanSubject)              throw new Error("Subject is required.");
  if (!cleanMessage)              throw new Error("Message body is required.");

  // Target recipient email address: rajesh.verma@galaxyweblinks.com
  const to        = process.env.SUPPORT_RECIPIENT_EMAIL || "rajesh.verma@galaxyweblinks.com";
  const fromEmail = process.env.SENDGRID_FROM_EMAIL     || "rajesh.verma@galaxyweblinks.com";

  const from = {
    email: fromEmail,
    name: "Drop A Hint Support",
  };

  const timestamp = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });

  const text = [
    "Drop A Hint – Support Request",
    "─".repeat(40),
    `User Name:  ${cleanName}`,
    `User Email: ${cleanEmail}`,
    ...(cleanPhone ? [`Phone:      ${cleanPhone}`] : []),
    `Store:      ${cleanShop}`,
    `Subject:    ${cleanSubject}`,
    `Date & Time:${timestamp}`,
    "",
    "Message:",
    cleanMessage,
  ].join("\n");

  return dispatch({
    to,
    from,
    replyTo: cleanEmail,
    subject: `Support Request - ${cleanName} [${cleanSubject}]`,
    text,
    html: supportTicketHtml({ cleanName, cleanEmail, cleanPhone, cleanShop, cleanSubject, cleanMessage, timestamp }),
  });
}

/**
 * Sends a product-referral (Drop a Hint) email to the gift recipient (Friend Email).
 *
 * @throws {Error} if the recipient email is invalid, the API key is missing,
 *   or SendGrid rejects the message.
 */
export async function sendReferralEmail({
  senderName,
  senderEmail,
  receiverName,
  receiverEmail,
  productTitle,
  productUrl,
  productImage,
  productPrice,
  productCompareAtPrice,
  customMessage,
  shop,
  configuredSenderEmail,
  configuredEmailSubject,
}) {
  const cleanSenderName          = sanitizeInput(senderName)           || "A friend";
  const cleanSenderEmail         = sanitizeInput(senderEmail);
  const cleanReceiverName        = sanitizeInput(receiverName)         || "Friend";
  const cleanReceiverEmail       = sanitizeInput(receiverEmail);
  const cleanProductTitle        = sanitizeInput(productTitle)         || "Featured Product";
  const cleanProductUrl          = sanitizeInput(productUrl)           || "#";
  const cleanProductImage        = sanitizeInput(productImage);
  const cleanProductPrice        = sanitizeInput(productPrice);
  const cleanProductCompareAtPrice = sanitizeInput(productCompareAtPrice);
  const cleanCustomMessage       = sanitizeInput(customMessage);
  const cleanShop                = sanitizeInput(shop)                 || "Our Store";

  // Debug log final email pricing before dispatch
  console.log('[SendGrid Referral] Pricing to be rendered in email:');
  console.log('  Sale Price       :', cleanProductPrice || '(none)');
  console.log('  Compare-At Price :', cleanProductCompareAtPrice || '(none)');
  console.log('  On Sale?         :', !!(cleanProductCompareAtPrice && cleanProductCompareAtPrice !== cleanProductPrice));

  if (!cleanReceiverEmail || !isValidEmail(cleanReceiverEmail)) {
    throw new Error("A valid Friend's Email (recipient) is required.");
  }
  if (!cleanSenderEmail || !isValidEmail(cleanSenderEmail)) {
    throw new Error("A valid Referrer Email is required.");
  }

  // Sender email: use admin configuredSenderEmail if set & valid, else fallback to SendGrid default
  const cleanConfiguredSender = sanitizeInput(configuredSenderEmail);
  const fromEmail = (cleanConfiguredSender && isValidEmail(cleanConfiguredSender))
    ? cleanConfiguredSender
    : (process.env.SENDGRID_FROM_EMAIL || "rajesh.verma@galaxyweblinks.com");

  const from = {
    email: fromEmail,
    name: `${cleanSenderName} via Drop A Hint`,
  };

  // Subject line: use admin configuredEmailSubject with placeholder support, else default
  let subject = `${cleanSenderName} invited you to check out a product!`;
  if (configuredEmailSubject && typeof configuredEmailSubject === "string" && configuredEmailSubject.trim()) {
    subject = configuredEmailSubject
      .replace(/\{\{\s*sender_name\s*\}\}/gi, cleanSenderName)
      .replace(/\{\{\s*receiver_name\s*\}\}/gi, cleanReceiverName)
      .replace(/\{\{\s*product_title\s*\}\}/gi, cleanProductTitle)
      .replace(/\{\{\s*shop\s*\}\}/gi, cleanShop)
      .trim();
  }

  // Build a human-readable price string for plain-text email
  let priceText = '';
  if (cleanProductPrice) {
    priceText = cleanProductCompareAtPrice && cleanProductCompareAtPrice !== cleanProductPrice
      ? `Sale: ${cleanProductPrice} (was ${cleanProductCompareAtPrice})`
      : cleanProductPrice;
  }

  const text = [
    `Hi ${cleanReceiverName},`,
    "",
    `${cleanSenderName} (${cleanSenderEmail}) invited you to check out this product from ${cleanShop}:`,
    "",
    `${cleanProductTitle}${priceText ? ` — ${priceText}` : ""}`,
    `Link: ${cleanProductUrl}`,
    ...(cleanCustomMessage ? ["", `Invitation Message: "${cleanCustomMessage}"`] : []),
    "",
    "Sent via Drop A Hint Theme Extension",
  ].join("\n");

  const replyToEmail = (cleanConfiguredSender && isValidEmail(cleanConfiguredSender))
    ? cleanConfiguredSender
    : cleanSenderEmail;

  return dispatch({
    to:      cleanReceiverEmail, // Friend Email
    from,                        // Configured Store Email or Verified SendGrid Sender
    replyTo: replyToEmail,       // Configured store email or Referrer Email
    subject,
    text,
    html:    referralHtml({
      cleanSenderName,
      cleanSenderEmail,
      cleanReceiverName,
      cleanShop,
      cleanProductTitle,
      cleanProductUrl,
      cleanProductPrice,
      cleanProductCompareAtPrice,
      cleanProductImage,
      cleanCustomMessage,
    }),
  });
}

/**
 * Sends a reward coupon email to the Referrer (User A) after friend (User B) purchases.
 */
export async function sendRewardEmail({
  senderName,
  senderEmail,
  discountCode,
  discountAmount,
  expiryDate,
  shop,
  configuredSenderEmail,
  configuredEmailSubject,
}) {
  const cleanSenderName     = sanitizeInput(senderName)     || "Valued Customer";
  const cleanSenderEmail    = sanitizeInput(senderEmail);
  const cleanDiscountCode   = sanitizeInput(discountCode);
  const cleanDiscountAmount = sanitizeInput(discountAmount);
  const cleanExpiryDate     = sanitizeInput(expiryDate);
  const cleanShop           = sanitizeInput(shop)           || "Our Store";

  if (!cleanSenderEmail || !isValidEmail(cleanSenderEmail)) {
    throw new Error("A valid Referrer Email is required for reward delivery.");
  }

  const maskedRecipient = `${cleanSenderEmail.slice(0, 3)}•••@${cleanSenderEmail.split("@")[1] || ""}`;
  console.log(`[EMAIL] reward email trigger started`);
  console.log(`[EMAIL] recipient=${maskedRecipient}`);

  // Sender email: use admin configuredSenderEmail if set & valid, else fallback to SendGrid default
  const cleanConfiguredSender = sanitizeInput(configuredSenderEmail);
  const fromEmail = (cleanConfiguredSender && isValidEmail(cleanConfiguredSender))
    ? cleanConfiguredSender
    : (process.env.SENDGRID_FROM_EMAIL || "rajesh.verma@galaxyweblinks.com");

  const from = {
    email: fromEmail,
    name: `${cleanShop} Rewards`,
  };

  // Subject line: use admin configuredEmailSubject with placeholder support, else default
  let subject = "🎉 Your Referral Was Successful! Here's Your Reward";
  if (configuredEmailSubject && typeof configuredEmailSubject === "string" && configuredEmailSubject.trim()) {
    subject = configuredEmailSubject
      .replace(/\{\{\s*sender_name\s*\}\}/gi, cleanSenderName)
      .replace(/\{\{\s*discount_code\s*\}\}/gi, cleanDiscountCode)
      .replace(/\{\{\s*discount_amount\s*\}\}/gi, cleanDiscountAmount)
      .replace(/\{\{\s*shop\s*\}\}/gi, cleanShop)
      .trim();
  }

  const text = [
    `Hello ${cleanSenderName},`,
    "",
    "Great news! Your friend has successfully purchased the product you recommended.",
    "",
    `As a reward, you've earned ${cleanDiscountAmount} your next purchase.`,
    "",
    `Your discount code: ${cleanDiscountCode}`,
    cleanExpiryDate ? `Valid until: ${cleanExpiryDate}` : "",
    "",
    "Use this code during checkout to receive your discount.",
    "",
    `Store: https://${cleanShop}`,
  ].filter(Boolean).join("\n");

  return dispatch({
    to:      cleanSenderEmail,
    from,
    subject,
    text,
    html:    rewardEmailHtml({
      cleanSenderName,
      cleanDiscountCode,
      cleanDiscountAmount,
      cleanExpiryDate,
      cleanShop,
    }),
  });
}
