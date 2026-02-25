# AUTO AWS-only architecture

## Services

- **CloudFront + S3**: static `web/` UI
- **API Gateway**: `/chat`, `/workspace/*`, `/runs/*`, optional `/channels/whatsapp/webhook`
- **Lambda**: `auto-api.mjs` control plane
- **S3**: workspace files (`workspaces/{workspaceId}/...`)
- **DynamoDB**: run metadata (`runId`, `status`, timestamps)
- **CodeBuild** (optional): sandbox run execution
- **Bedrock Runtime**: Nova model inference

## Recommended API mapping

- `POST /chat` -> Lambda `auto-api` route `/chat`
- `POST /workspace/create` -> Lambda `auto-api` route `/workspace/create`
- `POST /workspace/patch` -> Lambda `auto-api` route `/workspace/patch`
- `GET /workspace/list` -> Lambda `auto-api` route `/workspace/list`
- `POST /runs/start` -> Lambda `auto-api` route `/runs/start`
- `GET /runs/status` -> Lambda `auto-api` route `/runs/status`
- `GET|POST /channels/whatsapp/webhook` -> Lambda `whatsapp-webhook-stub`

## IAM permissions for auto-api Lambda

- Bedrock: `bedrock:InvokeModel` (specific Nova model ARN)
- S3:
  - `s3:PutObject` on `arn:aws:s3:::${WORKSPACE_BUCKET}/workspaces/*`
  - `s3:ListBucket` on `arn:aws:s3:::${WORKSPACE_BUCKET}`
- DynamoDB:
  - `dynamodb:PutItem`, `dynamodb:GetItem` on `${RUNS_TABLE}`
- CodeBuild (optional):
  - `codebuild:StartBuild` on `${CODEBUILD_PROJECT}`

## Guardrails

- Put auth (JWT/Cognito or custom token) in front of write routes.
- Keep shell/code execution in CodeBuild/ECS only.
- Do not expose GitHub write operations from public unauthenticated routes.
