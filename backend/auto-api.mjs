// AUTO control-plane Lambda (AWS-only scaffold)
// Routes:
// - POST /chat
// - POST /workspace/create
// - POST /workspace/patch
// - GET  /workspace/list?workspaceId=...
// - POST /runs/start
// - GET  /runs/status?runId=...
//
// Notes:
// - This is a safe scaffold, not a full production runner.
// - Workspace files are persisted in S3 under workspaces/{workspaceId}/...
// - Run metadata is persisted in DynamoDB.

import { randomUUID } from "node:crypto";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { S3Client, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { CodeBuildClient, StartBuildCommand } from "@aws-sdk/client-codebuild";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const MODEL_ID = process.env.NOVA_MODEL_ID || "nova-lite-v1";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const WORKSPACE_BUCKET = process.env.WORKSPACE_BUCKET || "";
const RUNS_TABLE = process.env.RUNS_TABLE || "";
const CODEBUILD_PROJECT = process.env.CODEBUILD_PROJECT || "";
const ADMIN_TOKEN = process.env.AUTO_ADMIN_TOKEN || "";

const bedrock = new BedrockRuntimeClient({ region: REGION });
const s3 = new S3Client({ region: REGION });
const codebuild = new CodeBuildClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function json(statusCode, body, origin) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin || ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,x-auto-token",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function parseJson(body) {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

function requiresAuth(pathname) {
  return pathname.includes("/workspace/patch") || pathname.includes("/runs/start");
}

function isAuthorized(event) {
  if (!ADMIN_TOKEN) return true;
  const token =
    event?.headers?.["x-auto-token"] ||
    event?.headers?.["X-Auto-Token"] ||
    event?.headers?.authorization ||
    event?.headers?.Authorization ||
    "";
  return String(token).trim() === ADMIN_TOKEN || String(token).trim() === `Bearer ${ADMIN_TOKEN}`;
}

async function chat(messages) {
  const userText = (Array.isArray(messages) ? messages : [])
    .map((m) => (m?.role === "user" ? String(m?.content || "") : ""))
    .filter(Boolean)
    .slice(-8)
    .join("\n\n");
  if (!userText) return { reply: "messages[] required" };

  const payload = {
    messages: [
      { role: "system", content: "You are AUTO, an AWS-only app-building assistant. Reply with concise steps first." },
      { role: "user", content: userText },
    ],
    temperature: 0.25,
    maxTokens: 900,
  };

  const cmd = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: new TextEncoder().encode(JSON.stringify(payload)),
  });
  const res = await bedrock.send(cmd);
  const raw = new TextDecoder().decode(res.body);
  const out = parseJson(raw);
  const reply =
    out?.output?.message?.content?.[0]?.text ||
    out?.output?.text ||
    out?.reply ||
    out?.completion ||
    raw;
  return { reply: String(reply || "") };
}

async function workspaceCreate() {
  const workspaceId = `ws_${Date.now()}_${randomUUID().slice(0, 8)}`;
  if (WORKSPACE_BUCKET) {
    await s3.send(
      new PutObjectCommand({
        Bucket: WORKSPACE_BUCKET,
        Key: `workspaces/${workspaceId}/.init`,
        Body: "initialized",
        ContentType: "text/plain",
      }),
    );
  }
  return { workspaceId };
}

async function workspacePatch(body) {
  const workspaceId = String(body?.workspaceId || "").trim();
  const filePath = String(body?.filePath || "").trim().replace(/^\/+/, "");
  const content = String(body?.content || "");
  if (!workspaceId || !filePath) throw new Error("workspaceId and filePath required");
  if (!WORKSPACE_BUCKET) throw new Error("WORKSPACE_BUCKET not configured");

  await s3.send(
    new PutObjectCommand({
      Bucket: WORKSPACE_BUCKET,
      Key: `workspaces/${workspaceId}/${filePath}`,
      Body: content,
      ContentType: "text/plain; charset=utf-8",
    }),
  );
  return { ok: true, workspaceId, filePath, bytes: content.length };
}

async function workspaceList(workspaceId) {
  if (!workspaceId) throw new Error("workspaceId required");
  if (!WORKSPACE_BUCKET) throw new Error("WORKSPACE_BUCKET not configured");

  const prefix = `workspaces/${workspaceId}/`;
  const out = await s3.send(new ListObjectsV2Command({ Bucket: WORKSPACE_BUCKET, Prefix: prefix, MaxKeys: 1000 }));
  const files = (out.Contents || [])
    .map((o) => String(o.Key || ""))
    .filter((k) => k && !k.endsWith("/.init"))
    .map((k) => k.replace(prefix, ""));
  return { workspaceId, files };
}

async function runsStart(body) {
  const workspaceId = String(body?.workspaceId || "").trim();
  const prompt = String(body?.prompt || "").trim();
  if (!workspaceId) throw new Error("workspaceId required");
  const runId = `run_${Date.now()}_${randomUUID().slice(0, 8)}`;

  if (RUNS_TABLE) {
    await ddb.send(
      new PutCommand({
        TableName: RUNS_TABLE,
        Item: {
          runId,
          workspaceId,
          prompt,
          status: "queued",
          createdAt: new Date().toISOString(),
        },
      }),
    );
  }

  if (CODEBUILD_PROJECT) {
    await codebuild.send(
      new StartBuildCommand({
        projectName: CODEBUILD_PROJECT,
        environmentVariablesOverride: [
          { name: "AUTO_RUN_ID", value: runId, type: "PLAINTEXT" },
          { name: "AUTO_WORKSPACE_ID", value: workspaceId, type: "PLAINTEXT" },
        ],
      }),
    );
  }

  return { runId, status: CODEBUILD_PROJECT ? "started" : "queued" };
}

async function runsStatus(runId) {
  if (!runId) throw new Error("runId required");
  if (!RUNS_TABLE) return { runId, status: "unknown", note: "RUNS_TABLE not configured" };
  const out = await ddb.send(new GetCommand({ TableName: RUNS_TABLE, Key: { runId } }));
  return out.Item || { runId, status: "not_found" };
}

export const handler = async (event) => {
  const origin = event?.headers?.origin || event?.headers?.Origin || "*";
  const method = String(event?.httpMethod || "GET").toUpperCase();
  const path = String(event?.path || event?.rawPath || "/");

  if (method === "OPTIONS") return json(200, { ok: true }, origin);
  if (requiresAuth(path) && !isAuthorized(event)) return json(401, { error: "Unauthorized" }, origin);

  try {
    if (method === "POST" && path.endsWith("/chat")) {
      const body = parseJson(event?.body);
      return json(200, await chat(body?.messages || []), origin);
    }
    if (method === "POST" && path.endsWith("/workspace/create")) {
      return json(200, await workspaceCreate(), origin);
    }
    if (method === "POST" && path.endsWith("/workspace/patch")) {
      const body = parseJson(event?.body);
      return json(200, await workspacePatch(body), origin);
    }
    if (method === "GET" && path.endsWith("/workspace/list")) {
      const qs = event?.queryStringParameters || {};
      return json(200, await workspaceList(String(qs.workspaceId || "")), origin);
    }
    if (method === "POST" && path.endsWith("/runs/start")) {
      const body = parseJson(event?.body);
      return json(200, await runsStart(body), origin);
    }
    if (method === "GET" && path.endsWith("/runs/status")) {
      const qs = event?.queryStringParameters || {};
      return json(200, await runsStatus(String(qs.runId || "")), origin);
    }
    return json(404, { error: "Route not found" }, origin);
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : "Internal error" }, origin);
  }
};
