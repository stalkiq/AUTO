// Lambda: POST /chat
// Calls Amazon Bedrock Runtime (Nova) and returns a simple reply.

import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const REGION = process.env.AWS_REGION || "us-east-1";
const MODEL_ID = process.env.NOVA_MODEL_ID || "amazon.nova-lite-v1:0";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

function json(statusCode, body, origin) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin || ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(body),
  };
}

function safeParse(body) {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

export const handler = async (event) => {
  const originHeader = event?.headers?.origin || event?.headers?.Origin || "*";

  if (event?.httpMethod === "OPTIONS") {
    return json(200, { ok: true }, originHeader);
  }
  if (event?.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" }, originHeader);
  }

  const body = safeParse(event?.body);
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const userText = messages
    .map((m) => (m?.role === "user" ? String(m?.content || "") : ""))
    .filter(Boolean)
    .slice(-6)
    .join("\n\n");

  if (!userText) {
    return json(400, { error: "messages[] required" }, originHeader);
  }

  const systemPrompt = "You are AUTO, an application-building assistant. Be concise. Propose a plan, then the next actionable step.";

  const client = new BedrockRuntimeClient({ region: REGION });

  const payload = {
    system: [{ text: systemPrompt }],
    messages: [
      { role: "user", content: [{ text: userText }] },
    ],
    inferenceConfig: {
      temperature: 0.3,
      max_new_tokens: 700,
    },
  };

  try {
    const cmd = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: new TextEncoder().encode(JSON.stringify(payload)),
    });

    const res = await client.send(cmd);
    const text = new TextDecoder().decode(res.body);
    const out = safeParse(text);

    const reply =
      out?.output?.message?.content?.[0]?.text ||
      out?.output?.text ||
      out?.reply ||
      out?.completion ||
      text;

    return json(200, { reply: String(reply || "") }, originHeader);
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : "Bedrock error" }, originHeader);
  }
};
