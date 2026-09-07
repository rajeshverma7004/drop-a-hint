import { authenticate } from "../shopify.server";
import { sendSupportEmail, isValidEmail } from "../services/email.server";

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

// Simple in-memory rate limiter: max 5 submissions per 15 minutes per identifier
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;

function isRateLimited(identifier) {
  const now = Date.now();
  const history = (rateLimitMap.get(identifier) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  if (history.length >= MAX_REQUESTS) return true;
  history.push(now);
  rateLimitMap.set(identifier, history);
  return false;
}

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, { status: 405 });
  }

  // Resolve shop domain (best-effort; non-fatal if unauthenticated in dev)
  let shop = "Unknown Store";
  try {
    const { session } = await authenticate.admin(request);
    if (session?.shop) shop = session.shop;
  } catch {
    // dev / unauthenticated – continue
  }

  // Rate limiting
  const clientKey =
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    shop;
  if (isRateLimited(clientKey)) {
    return jsonResponse(
      { error: "Too many requests. Please wait a few minutes before trying again." },
      { status: 429 }
    );
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON request body." }, { status: 400 });
  }

  const { name, email, phone, subject, message } = body || {};

  // Validate required fields
  const errors = {};
  if (!name?.trim())
    errors.name = "Name is required.";
  if (!email || !isValidEmail(email))
    errors.email = "A valid email address is required.";
  if (!subject?.trim())
    errors.subject = "Subject is required.";
  if (!message?.trim())
    errors.message = "Message is required.";

  if (Object.keys(errors).length > 0) {
    return jsonResponse(
      { error: "Validation failed.", details: errors },
      { status: 400 }
    );
  }

  // Send via SendGrid – return success ONLY on confirmed delivery
  try {
    const result = await sendSupportEmail({ name, email, phone, subject, message, shop });
    console.log(
      `[Support] Ticket delivered to rajesh.verma@galaxyweblinks.com. MessageId: ${result.messageId}, Status: ${result.statusCode}`
    );
    return jsonResponse({ success: true, message: "Support request submitted successfully!" });
  } catch (err) {
    console.error("[Support] ❌ Email delivery error:", err.message);
    return jsonResponse(
      { success: false, error: err.message || "Failed to send support email." },
      { status: 500 }
    );
  }
};
