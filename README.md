# AUTO (AWS-only OpenClaw-style scaffold)

AUTO is a CloudFront-hosted, chat-first builder that follows an OpenClaw-like pattern and a PARALINK-style command-center UI:

- **Control plane API** (Lambda + API Gateway)
- **Nova chat** (Bedrock Runtime)
- **Workspace persistence** (S3)
- **Run queue** (DynamoDB + optional CodeBuild)
- **Channel adapters** as stubs (WhatsApp webhook scaffold)

This repository is intentionally scaffold-first: safe defaults, no secrets committed, and no direct browser shell execution.

## What is included

- `web/`: static UI (PARALINK-like shell, left mission nav, center assistant, right AWS control panel)
- `backend/chat-lambda.mjs`: simple Nova chat Lambda
- `backend/auto-api.mjs`: single control-plane Lambda for chat/workspace/runs
- `backend/whatsapp-webhook-stub.mjs`: WhatsApp ingress stub
- `backend/package.json`: Lambda dependencies for AWS SDK v3
- `infra/DEPLOY_NOTES.md`: AWS-only deployment blueprint

## API routes (intended)

Mount `backend/auto-api.mjs` behind API Gateway routes:

- `POST /chat` -> Nova chat completion
- `POST /workspace/create` -> create workspace id
- `POST /workspace/patch` -> create/update file in workspace
- `GET /workspace/list?workspaceId=...` -> list workspace files
- `POST /runs/start` -> queue run + optional CodeBuild trigger
- `GET /runs/status?runId=...` -> run status

Optional:

- `POST /channels/whatsapp/webhook` -> WhatsApp adapter stub

Additional write-access routes:

- `POST /aws/validate` -> validates caller-provided AWS credentials (STS identity)
- `POST /aws/execute` -> executes allowlisted write operations using caller credentials

## Environment

Copy `.env.example` and set values in Lambda environment variables.

Key values:

- `AWS_REGION`
- `NOVA_MODEL_ID`
- `ALLOWED_ORIGIN`
- `WORKSPACE_BUCKET`
- `RUNS_TABLE`
- `CODEBUILD_PROJECT` (optional)
- `AUTO_ADMIN_TOKEN` (recommended)

## Local usage (UI only)

Open `web/index.html`, set `API base` in the header, and send prompts.

Example API base:

`https://xxxx.execute-api.us-east-1.amazonaws.com/prod`

## Security notes

- Do not expose push-to-GitHub or shell execution directly from public web routes.
- Put auth in front of mutation routes (`workspace/*`, `runs/*`).
- Keep code execution in a sandbox runner (CodeBuild/ECS), not in Lambda.
- `aws/execute` is allowlisted and should remain tightly scoped.
