# AUTO

A minimal scaffold for an "Auto"-style builder UI (Cursor/OpenClaw-inspired):

- Left: blank workspace panel (file tree scaffold)
- Center: chat (Amazon Nova via Bedrock)
- Right: actions/patch preview scaffold

This repo is intentionally lightweight and safe-by-default.

## Folders

- `web/` static UI (upload to S3 + CloudFront)
- `backend/` Lambda handlers
- `infra/` deployment notes

## Local usage (UI only)

Open `web/index.html`.

To connect chat, set an API base URL (e.g. `https://xxxx.execute-api.us-east-1.amazonaws.com/prod`) in the UI.

## Backend

Deploy `backend/chat-lambda.mjs` behind API Gateway as `POST /chat`.

## Security note

A public website should not be allowed to run arbitrary code or push to GitHub without authentication and a sandbox runner.
