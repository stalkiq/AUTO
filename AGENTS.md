# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

AUTO is an AWS-only, chat-first application builder scaffold. See `README.md` for full details.

- **`backend/`** — Node.js ESM Lambda handlers (no framework, no build step). Only dependency set: AWS SDK v3 clients.
- **`web/`** — Static vanilla HTML/CSS/JS frontend. No bundler, no framework.
- **`infra/`** — Deployment documentation only (no IaC).

### Running locally

**Frontend:** Serve `web/` with any static file server:
```
python3 -m http.server 8080 --directory web
```

**Backend:** There is no local Express/HTTP server wrapper. The Lambda handlers export `handler` functions that accept API Gateway-shaped events. To test locally, invoke handlers programmatically:
```js
import('./backend/auto-api.mjs').then(async (m) => {
  const res = await m.handler({ httpMethod: 'POST', path: '/chat', headers: {}, body: '...' });
  console.log(res);
});
```

### Key caveats

- The `POST /chat` route requires real AWS credentials with Bedrock `bedrock:InvokeModel` permission. Without them, the handler returns `500 Could not load credentials from any providers`.
- Routes that depend on S3 (`/workspace/patch`, `/workspace/list`) or DynamoDB (`/runs/start`) will fail without configured `WORKSPACE_BUCKET` / `RUNS_TABLE` env vars pointing at real AWS resources. However, `/workspace/create` succeeds even without a bucket (it skips the S3 call), and `/runs/status` returns a graceful fallback.
- `POST /aws/validate` and `POST /aws/execute` use **caller-provided** AWS credentials (not server env). They require auth if `AUTO_ADMIN_TOKEN` is set. `/aws/execute` supports an allowlisted set of operations: `s3_put_object`, `s3_delete_object`, `cloudfront_invalidate`, `dynamodb_put_item`, `lambda_update_env`.
- There is **no test suite, no linter config, and no build step** in this scaffold. Code quality checks must be done manually or by adding tooling.
- Environment variables are documented in `.env.example`. For Lambda deployment, set them as Lambda environment variables per `infra/DEPLOY_NOTES.md`.
- All backend files are `.mjs` (ESM). The `package.json` has `"type": "module"`.

### CloudFront deployment

The frontend is deployed to CloudFront at **https://dszqj6kafy4d7.cloudfront.net/**.

- **S3 bucket:** `auto-frontend-016442247702-us-east-1`
- **CloudFront distribution:** `E31YIXNNRC4RYX` (`dszqj6kafy4d7.cloudfront.net`)
- **Origin Access Control:** `EE8HJ9BHR0JQO`

To redeploy frontend changes:
```sh
aws s3 sync web/ s3://auto-frontend-016442247702-us-east-1/ --delete
aws cloudfront create-invalidation --distribution-id E31YIXNNRC4RYX --paths "/*"
```

Requires `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` secrets with S3 + CloudFront permissions.

### Live backend (Lambda + API Gateway)

- **API Gateway:** `https://pxiaathir6.execute-api.us-east-1.amazonaws.com` (HTTP API, id: `pxiaathir6`)
- **Lambda function:** `auto-api` (Node.js 20, handler: `auto-api.handler`)
- **IAM role:** `auto-lambda-role`
- **DynamoDB table:** `auto-runs` (partition key: `runId`)
- **Workspace bucket:** `auto-workspaces-016442247702-us-east-1`
- **Bedrock model:** `amazon.nova-lite-v1:0` (Nova Lite)

To redeploy backend changes:
```sh
cd backend && rm -rf /tmp/lambda-pkg /tmp/auto-api-lambda.zip
mkdir -p /tmp/lambda-pkg && cp -r node_modules *.mjs package.json /tmp/lambda-pkg/
cd /tmp/lambda-pkg && zip -qr /tmp/auto-api-lambda.zip .
aws lambda update-function-code --function-name auto-api --zip-file fileb:///tmp/auto-api-lambda.zip
```

### New feature routes

- `POST /chat/speak` — Polly neural TTS (Ruth voice). Send `{ "text": "..." }`, returns `{ "audio": "<base64 mp3>", "contentType": "audio/mpeg" }`.
- `POST /image/generate` — Nova Canvas text-to-image. Send `{ "prompt": "..." }`, returns `{ "image": "<base64 png>" }`. 512x512.
- `POST /image/analyze` — Nova Lite vision. Send `{ "image": "<base64>", "question": "..." }`, returns `{ "analysis": "..." }`.
- `POST /github/analyze` — Fetches GitHub repo tree + README via public API, sends to Nova for analysis. Send `{ "url": "https://github.com/owner/repo" }`, returns repo info + analysis with suggested improvements.

### Nova Bedrock API format

The Nova model requires a specific payload format different from other models:
- System prompt goes in a top-level `system` array: `[{ "text": "..." }]`
- Message content is an array: `[{ "text": "..." }]`
- Inference config uses `max_new_tokens` (not `maxTokens`) inside an `inferenceConfig` object

### Important: do NOT modify

- Any existing CloudFront distributions other than `E31YIXNNRC4RYX` (the AUTO frontend)
- Any existing S3 buckets, Lambda functions, or other AWS resources not prefixed with `auto-`
