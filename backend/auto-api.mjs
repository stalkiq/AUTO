// AUTO control-plane Lambda (AWS-only, OpenClaw-like scaffold)
// Routes:
// - POST /chat
// - POST /workspace/create
// - POST /workspace/patch
// - GET  /workspace/list?workspaceId=...
// - POST /runs/start
// - GET  /runs/status?runId=...
// - POST /aws/validate
// - POST /aws/execute
//
// IMPORTANT:
// - This scaffold allows write operations using caller-provided AWS credentials.
// - Keep auth enabled in production and restrict operations to an allowlist.

import { randomUUID } from "node:crypto";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { CodeBuildClient, StartBuildCommand } from "@aws-sdk/client-codebuild";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { LambdaClient, UpdateFunctionConfigurationCommand, GetFunctionConfigurationCommand } from "@aws-sdk/client-lambda";

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
  return (
    pathname.includes("/workspace/patch") ||
    pathname.includes("/runs/start") ||
    pathname.includes("/aws/execute") ||
    pathname.includes("/aws/validate")
  );
}

function isAuthorized(event) {
  if (!ADMIN_TOKEN) return true;
  const token =
    event?.headers?.["x-auto-token"] ||
    event?.headers?.["X-Auto-Token"] ||
    event?.headers?.authorization ||
    event?.headers?.Authorization ||
    "";
  const t = String(token).trim();
  return t === ADMIN_TOKEN || t === `Bearer ${ADMIN_TOKEN}`;
}

function getAwsCreds(body) {
  const c = body?.awsCredentials || {};
  const accessKeyId = String(c.accessKeyId || "").trim();
  const secretAccessKey = String(c.secretAccessKey || "").trim();
  const sessionToken = String(c.sessionToken || "").trim();
  const region = String(c.region || REGION).trim() || REGION;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("awsCredentials.accessKeyId and awsCredentials.secretAccessKey are required");
  }
  return {
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    },
  };
}

function safeJsonParse(v) {
  try {
    return typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return v;
  }
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
      { role: "system", content: "You are AUTO, an AWS-only app-building assistant. Be concise and action-oriented." },
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
  const out = await s3.send(
    new ListObjectsV2Command({
      Bucket: WORKSPACE_BUCKET,
      Prefix: prefix,
      MaxKeys: 1000,
    }),
  );
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

async function awsValidate(body) {
  const config = getAwsCreds(body);
  const sts = new STSClient(config);
  const ident = await sts.send(new GetCallerIdentityCommand({}));
  return {
    ok: true,
    identity: {
      account: ident.Account || "",
      arn: ident.Arn || "",
      userId: ident.UserId || "",
    },
    region: config.region,
    writeOpsSupported: [
      "s3_put_object",
      "s3_delete_object",
      "cloudfront_invalidate",
      "dynamodb_put_item",
      "lambda_update_env",
    ],
  };
}

async function awsExecute(body) {
  const config = getAwsCreds(body);
  const operation = String(body?.operation || "").trim();
  const input = safeJsonParse(body?.input || {});
  if (!operation) throw new Error("operation required");

  if (operation === "s3_put_object") {
    const bucket = String(input?.bucket || "").trim();
    const key = String(input?.key || "").trim().replace(/^\/+/, "");
    const content = String(input?.content || "");
    const contentType = String(input?.contentType || "text/plain; charset=utf-8");
    if (!bucket || !key) throw new Error("input.bucket and input.key required");
    const c = new S3Client(config);
    await c.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentType: contentType,
      }),
    );
    return { ok: true, operation, bucket, key, bytes: content.length };
  }

  if (operation === "s3_delete_object") {
    const bucket = String(input?.bucket || "").trim();
    const key = String(input?.key || "").trim().replace(/^\/+/, "");
    if (!bucket || !key) throw new Error("input.bucket and input.key required");
    const c = new S3Client(config);
    await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return { ok: true, operation, bucket, key };
  }

  if (operation === "cloudfront_invalidate") {
    const distributionId = String(input?.distributionId || "").trim();
    const paths = Array.isArray(input?.paths) && input.paths.length ? input.paths.map((p) => String(p)) : ["/*"];
    if (!distributionId) throw new Error("input.distributionId required");
    const c = new CloudFrontClient(config);
    const callerReference = `auto-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const res = await c.send(
      new CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: {
          CallerReference: callerReference,
          Paths: { Quantity: paths.length, Items: paths },
        },
      }),
    );
    return {
      ok: true,
      operation,
      distributionId,
      invalidationId: res?.Invalidation?.Id || null,
      status: res?.Invalidation?.Status || null,
    };
  }

  if (operation === "dynamodb_put_item") {
    const tableName = String(input?.tableName || "").trim();
    const item = input?.item;
    if (!tableName || !item || typeof item !== "object") throw new Error("input.tableName and input.item required");
    const doc = DynamoDBDocumentClient.from(new DynamoDBClient(config));
    await doc.send(new PutCommand({ TableName: tableName, Item: item }));
    return { ok: true, operation, tableName };
  }

  if (operation === "lambda_update_env") {
    const functionName = String(input?.functionName || "").trim();
    const environment = input?.environment;
    const merge = input?.merge !== false;
    if (!functionName || !environment || typeof environment !== "object") {
      throw new Error("input.functionName and input.environment object required");
    }
    const c = new LambdaClient(config);

    let variables = {};
    if (merge) {
      const cur = await c.send(new GetFunctionConfigurationCommand({ FunctionName: functionName }));
      variables = { ...(cur?.Environment?.Variables || {}), ...environment };
    } else {
      variables = { ...environment };
    }

    const out = await c.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: functionName,
        Environment: { Variables: variables },
      }),
    );
    return {
      ok: true,
      operation,
      functionName,
      lastUpdateStatus: out?.LastUpdateStatus || null,
      version: out?.Version || null,
    };
  }

  throw new Error(`Unsupported operation: ${operation}`);
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
    if (method === "POST" && path.endsWith("/aws/validate")) {
      const body = parseJson(event?.body);
      return json(200, await awsValidate(body), origin);
    }
    if (method === "POST" && path.endsWith("/aws/execute")) {
      const body = parseJson(event?.body);
      return json(200, await awsExecute(body), origin);
    }
    return json(404, { error: "Route not found" }, origin);
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : "Internal error" }, origin);
  }
};
