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
- There is **no test suite, no linter config, and no build step** in this scaffold. Code quality checks must be done manually or by adding tooling.
- Environment variables are documented in `.env.example`. For Lambda deployment, set them as Lambda environment variables per `infra/DEPLOY_NOTES.md`.
- All backend files are `.mjs` (ESM). The `package.json` has `"type": "module"`.
