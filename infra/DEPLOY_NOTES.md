# AUTO deploy notes (high level)

## UI (CloudFront)

- Upload `web/` to S3
- Put CloudFront in front

## Backend (API Gateway + Lambda)

- Create Lambda (Node.js 20)
- Handler: `backend/chat-lambda.mjs`
- Route: `POST /chat`

Set env vars:

- `AWS_REGION=us-east-1`
- `NOVA_MODEL_ID=nova-lite-v1`
- `ALLOWED_ORIGIN=<your cloudfront domain>`

Grant permissions:

- `bedrock:InvokeModel` for the chosen Nova model.
