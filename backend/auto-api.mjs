// AUTO control-plane Lambda (AWS-only, OpenClaw-like scaffold)
// Routes:
// - POST /chat           — Nova chat
// - POST /chat/speak     — Polly TTS
// - POST /image/generate — Nova Canvas image generation
// - POST /image/analyze  — Nova vision (describe an image)
// - POST /github/analyze — Fetch + describe a GitHub repo
// - POST /workspace/create, /workspace/patch, GET /workspace/list
// - POST /runs/start, GET /runs/status
// - POST /aws/validate, /aws/execute

import { randomUUID } from "node:crypto";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { CodeBuildClient, StartBuildCommand } from "@aws-sdk/client-codebuild";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { LambdaClient, UpdateFunctionConfigurationCommand, GetFunctionConfigurationCommand } from "@aws-sdk/client-lambda";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";

const REGION = process.env.AWS_REGION || "us-east-1";
const MODEL_ID = process.env.NOVA_MODEL_ID || "amazon.nova-lite-v1:0";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const WORKSPACE_BUCKET = process.env.WORKSPACE_BUCKET || "";
const RUNS_TABLE = process.env.RUNS_TABLE || "";
const CODEBUILD_PROJECT = process.env.CODEBUILD_PROJECT || "";
const ADMIN_TOKEN = process.env.AUTO_ADMIN_TOKEN || "";

const bedrock = new BedrockRuntimeClient({ region: REGION });
const s3 = new S3Client({ region: REGION });
const codebuild = new CodeBuildClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const polly = new PollyClient({ region: REGION });

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

  const systemPrompt = `You are AUTO, an AI that EXECUTES actions — not just explains them. You run inside a web app connected to real AWS services.

CAPABILITIES YOU CAN TRIGGER (tell the user to use these via the app):
- CHAT: You answer questions (this is what you're doing now)
- SPEAK: Any of your responses can be read aloud with Polly (speaker icon)
- IMAGE GENERATE: User clicks "Image" button to generate images with Nova Canvas
- IMAGE ANALYZE: User clicks "Analyze" button to upload and analyze photos
- GITHUB ANALYZE: User clicks "GitHub" button to analyze any public repo
- GITHUB PUSH: Push files to any GitHub repo (user provides token in Settings)
- AWS WRITE ACTIONS (via Settings panel):
  * s3_put_object — Upload/create files in S3 buckets
  * s3_delete_object — Delete files from S3
  * cloudfront_invalidate — Clear CloudFront CDN cache
  * dynamodb_put_item — Write records to DynamoDB tables
  * lambda_update_env — Update Lambda function environment variables

RULES:
1. When a user asks to DO something, tell them exactly which button/action to use in the app. Don't give generic CLI instructions.
2. If they want to push code to GitHub: tell them to click "GitHub Push" in the tools bar, or provide their GitHub token in Settings to enable it.
3. If they want to modify AWS resources: tell them to open Settings and use the Write Action form.
4. Be SPECIFIC with bucket names, file paths, and JSON payloads they can copy-paste.
5. Keep responses short and actionable. No walls of text.`;

  const payload = {
    system: [{ text: systemPrompt }],
    messages: [
      { role: "user", content: [{ text: userText }] },
    ],
    inferenceConfig: {
      temperature: 0.25,
      max_new_tokens: 900,
    },
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

async function workspaceRead(workspaceId, filePath) {
  if (!workspaceId || !filePath) throw new Error("workspaceId and filePath required");
  if (!WORKSPACE_BUCKET) throw new Error("WORKSPACE_BUCKET not configured");
  const key = `workspaces/${workspaceId}/${filePath.replace(/^\/+/, "")}`;
  const out = await s3.send(new GetObjectCommand({ Bucket: WORKSPACE_BUCKET, Key: key }));
  const content = await out.Body.transformToString();
  return { workspaceId, filePath, content, contentType: out.ContentType || "text/plain" };
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

// --- Polly TTS ---
async function speak(text) {
  const clean = String(text || "").slice(0, 3000);
  if (!clean) return { error: "text required" };
  const cmd = new SynthesizeSpeechCommand({
    Text: clean,
    OutputFormat: "mp3",
    VoiceId: "Ruth",
    Engine: "neural",
  });
  const res = await polly.send(cmd);
  const chunks = [];
  for await (const chunk of res.AudioStream) chunks.push(chunk);
  const buf = Buffer.concat(chunks);
  return { audio: buf.toString("base64"), contentType: "audio/mpeg" };
}

// --- Nova Canvas image generation ---
async function generateImage(prompt) {
  const p = String(prompt || "").trim();
  if (!p) return { error: "prompt required" };
  const payload = {
    taskType: "TEXT_IMAGE",
    textToImageParams: { text: p },
    imageGenerationConfig: { numberOfImages: 1, height: 512, width: 512, quality: "standard" },
  };
  const cmd = new InvokeModelCommand({
    modelId: "amazon.nova-canvas-v1:0",
    contentType: "application/json",
    accept: "application/json",
    body: new TextEncoder().encode(JSON.stringify(payload)),
  });
  const res = await bedrock.send(cmd);
  const raw = new TextDecoder().decode(res.body);
  const out = parseJson(raw);
  const b64 = out?.images?.[0];
  if (!b64) return { error: "No image returned" };
  return { image: b64, contentType: "image/png" };
}

// --- Nova vision (image analysis) ---
async function analyzeImage(imageBase64, question) {
  const q = String(question || "Describe this image in detail.").trim();
  const payload = {
    system: [{ text: "You are AUTO, an AI assistant. Analyze the provided image thoroughly." }],
    messages: [{
      role: "user",
      content: [
        { image: { format: "png", source: { bytes: imageBase64 } } },
        { text: q },
      ],
    }],
    inferenceConfig: { temperature: 0.3, max_new_tokens: 1000 },
  };
  const cmd = new InvokeModelCommand({
    modelId: "amazon.nova-lite-v1:0",
    contentType: "application/json",
    accept: "application/json",
    body: new TextEncoder().encode(JSON.stringify(payload)),
  });
  const res = await bedrock.send(cmd);
  const raw = new TextDecoder().decode(res.body);
  const out = parseJson(raw);
  const reply = out?.output?.message?.content?.[0]?.text || raw;
  return { analysis: String(reply || "") };
}

// --- GitHub repo analysis ---
async function analyzeGitHub(repoUrl) {
  const url = String(repoUrl || "").trim();
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error("Provide a valid GitHub URL (e.g. https://github.com/owner/repo)");
  const owner = match[1];
  const repo = match[2].replace(/\.git$/, "");
  const api = `https://api.github.com/repos/${owner}/${repo}`;

  const headers = { "User-Agent": "AUTO-app", Accept: "application/vnd.github.v3+json" };
  const repoRes = await fetch(api, { headers });
  if (!repoRes.ok) throw new Error(`GitHub API error: ${repoRes.status}`);
  const repoData = await repoRes.json();

  const treeRes = await fetch(`${api}/git/trees/${repoData.default_branch}?recursive=1`, { headers });
  const treeData = treeRes.ok ? await treeRes.json() : { tree: [] };
  const files = (treeData.tree || []).filter((f) => f.type === "blob").map((f) => f.path).slice(0, 200);

  let readme = "";
  try {
    const readmeRes = await fetch(`${api}/readme`, { headers: { ...headers, Accept: "application/vnd.github.v3.raw" } });
    if (readmeRes.ok) readme = (await readmeRes.text()).slice(0, 4000);
  } catch {}

  let packageJson = "";
  try {
    const pkgRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${repoData.default_branch}/package.json`, { headers });
    if (pkgRes.ok) packageJson = (await pkgRes.text()).slice(0, 2000);
  } catch {}

  const summary = [
    `Repository: ${owner}/${repo}`,
    `Description: ${repoData.description || "None"}`,
    `Language: ${repoData.language || "Unknown"}`,
    `Stars: ${repoData.stargazers_count}, Forks: ${repoData.forks_count}`,
    `Default branch: ${repoData.default_branch}`,
    `\nFile tree (${files.length} files):\n${files.join("\n")}`,
    readme ? `\nREADME:\n${readme}` : "",
    packageJson ? `\npackage.json:\n${packageJson}` : "",
  ].join("\n");

  const prompt = `Analyze this GitHub repository and provide:
1. A clear description of what this project does
2. The tech stack and architecture
3. Strengths of the codebase
4. Suggested improvements or changes the owner could make
5. Ask if the user would like help implementing any of these changes

Repository data:
${summary}`;

  const payload = {
    system: [{ text: "You are AUTO, an expert code reviewer and AWS architect. Analyze codebases thoroughly and suggest practical improvements. Be specific with file names and line-level suggestions." }],
    messages: [{ role: "user", content: [{ text: prompt }] }],
    inferenceConfig: { temperature: 0.3, max_new_tokens: 1500 },
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
  const analysis = out?.output?.message?.content?.[0]?.text || raw;

  return {
    repo: `${owner}/${repo}`,
    description: repoData.description || "",
    language: repoData.language || "",
    stars: repoData.stargazers_count,
    fileCount: files.length,
    analysis: String(analysis || ""),
  };
}

// --- GitHub push (create/update files) ---
async function githubPush(body) {
  const token = String(body?.token || "").trim();
  if (!token) throw new Error("GitHub personal access token required. Add it in Settings.");
  const repoUrl = String(body?.repo || "").trim();
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error("Provide a valid GitHub repo URL");
  const owner = match[1];
  const repo = match[2].replace(/\.git$/, "");
  const filePath = String(body?.path || "").trim().replace(/^\/+/, "");
  const content = String(body?.content || "");
  const message = String(body?.message || "Update via AUTO").trim();
  const branch = String(body?.branch || "main").trim();

  if (!filePath) throw new Error("File path required (e.g. src/index.js)");

  const headers = {
    "User-Agent": "AUTO-app",
    Authorization: `token ${token}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };

  let sha;
  try {
    const existing = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`, { headers });
    if (existing.ok) {
      const data = await existing.json();
      sha = data.sha;
    }
  } catch {}

  const payload = {
    message,
    content: Buffer.from(content).toString("base64"),
    branch,
    ...(sha ? { sha } : {}),
  };

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }

  const result = await res.json();
  return {
    ok: true,
    repo: `${owner}/${repo}`,
    path: filePath,
    branch,
    sha: result?.content?.sha || "",
    htmlUrl: result?.content?.html_url || "",
  };
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
  const method = String(event?.requestContext?.http?.method || event?.httpMethod || "GET").toUpperCase();
  const path = String(event?.rawPath || event?.path || "/");
  const body = typeof event?.body === "string" && event?.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf-8")
    : event?.body;

  if (method === "OPTIONS") return json(200, { ok: true }, origin);
  if (requiresAuth(path) && !isAuthorized(event)) return json(401, { error: "Unauthorized" }, origin);

  try {
    if (method === "POST" && path.endsWith("/chat/speak")) {
      const parsed = parseJson(body);
      return json(200, await speak(parsed?.text || ""), origin);
    }
    if (method === "POST" && path.endsWith("/image/generate")) {
      const parsed = parseJson(body);
      return json(200, await generateImage(parsed?.prompt || ""), origin);
    }
    if (method === "POST" && path.endsWith("/image/analyze")) {
      const parsed = parseJson(body);
      return json(200, await analyzeImage(parsed?.image || "", parsed?.question || ""), origin);
    }
    if (method === "POST" && path.endsWith("/github/analyze")) {
      const parsed = parseJson(body);
      return json(200, await analyzeGitHub(parsed?.url || ""), origin);
    }
    if (method === "POST" && path.endsWith("/github/push")) {
      const parsed = parseJson(body);
      return json(200, await githubPush(parsed), origin);
    }
    if (method === "POST" && path.endsWith("/chat")) {
      const parsed = parseJson(body);
      return json(200, await chat(parsed?.messages || []), origin);
    }
    if (method === "POST" && path.endsWith("/workspace/create")) {
      return json(200, await workspaceCreate(), origin);
    }
    if (method === "POST" && path.endsWith("/workspace/patch")) {
      const parsed = parseJson(body);
      return json(200, await workspacePatch(parsed), origin);
    }
    if (method === "GET" && path.endsWith("/workspace/list")) {
      const qs = event?.queryStringParameters || {};
      return json(200, await workspaceList(String(qs.workspaceId || "")), origin);
    }
    if (method === "GET" && path.endsWith("/workspace/read")) {
      const qs = event?.queryStringParameters || {};
      return json(200, await workspaceRead(String(qs.workspaceId || ""), String(qs.filePath || "")), origin);
    }
    if (method === "POST" && path.endsWith("/runs/start")) {
      const parsed = parseJson(body);
      return json(200, await runsStart(parsed), origin);
    }
    if (method === "GET" && path.endsWith("/runs/status")) {
      const qs = event?.queryStringParameters || {};
      return json(200, await runsStatus(String(qs.runId || "")), origin);
    }
    if (method === "POST" && path.endsWith("/aws/validate")) {
      const parsed = parseJson(body);
      return json(200, await awsValidate(parsed), origin);
    }
    if (method === "POST" && path.endsWith("/aws/execute")) {
      const parsed = parseJson(body);
      return json(200, await awsExecute(parsed), origin);
    }
    return json(404, { error: "Route not found" }, origin);
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : "Internal error" }, origin);
  }
};
