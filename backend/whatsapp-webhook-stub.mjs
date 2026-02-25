// WhatsApp webhook scaffold for AUTO (AWS-only)
// This file is intentionally a stub. Real integration needs provider onboarding.
// Recommended options:
// 1) Official WhatsApp Cloud API webhook (Meta app + verify token + signed requests)
// 2) Bridge service -> POST normalized messages to /chat

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  const method = String(event?.httpMethod || "GET").toUpperCase();

  if (method === "OPTIONS") return json(200, { ok: true });

  // Meta webhook verification challenge
  if (method === "GET") {
    const q = event?.queryStringParameters || {};
    const mode = String(q["hub.mode"] || "");
    const token = String(q["hub.verify_token"] || "");
    const challenge = String(q["hub.challenge"] || "");
    if (mode === "subscribe" && VERIFY_TOKEN && token === VERIFY_TOKEN) {
      return { statusCode: 200, body: challenge };
    }
    return json(403, { error: "Webhook verification failed" });
  }

  if (method === "POST") {
    // In production:
    // - verify x-hub-signature-256
    // - parse inbound message payload
    // - route text into AUTO /chat with a channel-scoped session
    return json(202, {
      status: "accepted",
      message: "Webhook stub received payload. Routing to AUTO chat is not enabled in scaffold mode.",
    });
  }

  return json(405, { error: "Method not allowed" });
};
