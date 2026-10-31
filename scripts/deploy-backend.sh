#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-backend.sh
#
# Packages and deploys the Lambda function + API Gateway for Temple Relay.
# Run this from the project root: ./scripts/deploy-backend.sh
#
# Prerequisites:
#   - AWS CLI installed and configured (run `aws configure` first)
#   - Node.js 18+ installed
#   - All values in .env.example filled in (or exported as environment variables)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuration — edit these values ────────────────────────────────────────
AWS_REGION="${AWS_REGION:-us-east-1}"
LAMBDA_FUNCTION_NAME="temple-relay-api"
LAMBDA_ROLE_NAME="temple-relay-lambda-role"
API_NAME="temple-relay-api"
STAGE_NAME="prod"

# Google Sheets config — must be set as environment variables before running
: "${SPREADSHEET_ID:?Error: SPREADSHEET_ID is not set. Export it first.}"
: "${GOOGLE_SERVICE_ACCOUNT_JSON:?Error: GOOGLE_SERVICE_ACCOUNT_JSON is not set. Export it first.}"
SHEET_NAME="${SHEET_NAME:-Ordinances}"
SPREADSHEET_URL="${SPREADSHEET_URL:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_DIR/backend"
BUILD_DIR="$PROJECT_DIR/.build"

echo ""
echo "=== Temple Relay — Backend Deployment ==="
echo "Region:   $AWS_REGION"
echo "Function: $LAMBDA_FUNCTION_NAME"
echo ""

# ── Step 1: Install dependencies ──────────────────────────────────────────────
echo "→ Installing backend dependencies..."
cd "$BACKEND_DIR"
npm install --omit=dev

# ── Step 2: Package into a ZIP ────────────────────────────────────────────────
echo "→ Creating deployment package..."
mkdir -p "$BUILD_DIR"
ZIP_PATH="$BUILD_DIR/lambda.zip"
rm -f "$ZIP_PATH"
cd "$BACKEND_DIR"
zip -r "$ZIP_PATH" index.js node_modules package.json > /dev/null
echo "   Package: $ZIP_PATH ($(du -sh "$ZIP_PATH" | cut -f1))"

# ── Step 3: Get AWS account ID ────────────────────────────────────────────────
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --region "$AWS_REGION")
echo "→ AWS Account: $ACCOUNT_ID"

# ── Step 4: Create or update IAM role ─────────────────────────────────────────
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${LAMBDA_ROLE_NAME}"
echo "→ Checking IAM role..."

if aws iam get-role --role-name "$LAMBDA_ROLE_NAME" > /dev/null 2>&1; then
  echo "   Role already exists: $ROLE_ARN"
else
  echo "   Creating IAM role: $LAMBDA_ROLE_NAME"
  aws iam create-role \
    --role-name "$LAMBDA_ROLE_NAME" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": { "Service": "lambda.amazonaws.com" },
        "Action": "sts:AssumeRole"
      }]
    }' > /dev/null

  # Attach basic Lambda execution policy (allows writing to CloudWatch Logs)
  aws iam attach-role-policy \
    --role-name "$LAMBDA_ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

  echo "   Waiting for role to propagate..."
  sleep 10
fi

# ── Step 5: Create or update Lambda function ──────────────────────────────────
ENV_VARS="SPREADSHEET_ID=${SPREADSHEET_ID},SHEET_NAME=${SHEET_NAME},SPREADSHEET_URL=${SPREADSHEET_URL},GOOGLE_SERVICE_ACCOUNT_JSON=${GOOGLE_SERVICE_ACCOUNT_JSON}"

if aws lambda get-function --function-name "$LAMBDA_FUNCTION_NAME" --region "$AWS_REGION" > /dev/null 2>&1; then
  echo "→ Updating existing Lambda function..."
  aws lambda update-function-code \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --zip-file "fileb://$ZIP_PATH" \
    --region "$AWS_REGION" > /dev/null

  echo "   Waiting for code update..."
  aws lambda wait function-updated \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --region "$AWS_REGION"

  echo "   Updating environment variables..."
  aws lambda update-function-configuration \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --environment "Variables={SPREADSHEET_ID=${SPREADSHEET_ID},SHEET_NAME=${SHEET_NAME},SPREADSHEET_URL=${SPREADSHEET_URL},GOOGLE_SERVICE_ACCOUNT_JSON=${GOOGLE_SERVICE_ACCOUNT_JSON}}" \
    --region "$AWS_REGION" > /dev/null
else
  echo "→ Creating new Lambda function..."
  aws lambda create-function \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --runtime nodejs18.x \
    --role "$ROLE_ARN" \
    --handler index.handler \
    --zip-file "fileb://$ZIP_PATH" \
    --timeout 15 \
    --memory-size 256 \
    --environment "Variables={SPREADSHEET_ID=${SPREADSHEET_ID},SHEET_NAME=${SHEET_NAME},SPREADSHEET_URL=${SPREADSHEET_URL},GOOGLE_SERVICE_ACCOUNT_JSON=${GOOGLE_SERVICE_ACCOUNT_JSON}}" \
    --region "$AWS_REGION" > /dev/null

  echo "   Waiting for Lambda to be ready..."
  aws lambda wait function-active \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --region "$AWS_REGION"
fi

LAMBDA_ARN=$(aws lambda get-function \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --query 'Configuration.FunctionArn' \
  --output text \
  --region "$AWS_REGION")
echo "   Lambda ARN: $LAMBDA_ARN"

# ── Step 6: Create or reuse API Gateway ───────────────────────────────────────
echo "→ Setting up API Gateway..."

API_ID=$(aws apigateway get-rest-apis \
  --region "$AWS_REGION" \
  --query "items[?name=='${API_NAME}'].id | [0]" \
  --output text)

if [ "$API_ID" = "None" ] || [ -z "$API_ID" ]; then
  echo "   Creating new REST API..."
  API_ID=$(aws apigateway create-rest-api \
    --name "$API_NAME" \
    --region "$AWS_REGION" \
    --query 'id' \
    --output text)
fi
echo "   API ID: $API_ID"

ROOT_RESOURCE_ID=$(aws apigateway get-resources \
  --rest-api-id "$API_ID" \
  --region "$AWS_REGION" \
  --query 'items[?path==`/`].id | [0]' \
  --output text)

# Helper to create or get a resource path
create_or_get_resource() {
  local path_part=$1
  local EXISTING=$(aws apigateway get-resources \
    --rest-api-id "$API_ID" \
    --region "$AWS_REGION" \
    --query "items[?pathPart=='${path_part}'].id | [0]" \
    --output text)
  if [ "$EXISTING" = "None" ] || [ -z "$EXISTING" ]; then
    aws apigateway create-resource \
      --rest-api-id "$API_ID" \
      --parent-id "$ROOT_RESOURCE_ID" \
      --path-part "$path_part" \
      --region "$AWS_REGION" \
      --query 'id' \
      --output text
  else
    echo "$EXISTING"
  fi
}

# Helper to add method + Lambda integration
add_method_integration() {
  local resource_id=$1
  local http_method=$2

  # Create method (ignore error if already exists)
  aws apigateway put-method \
    --rest-api-id "$API_ID" \
    --resource-id "$resource_id" \
    --http-method "$http_method" \
    --authorization-type NONE \
    --region "$AWS_REGION" > /dev/null 2>&1 || true

  # Lambda integration URI
  local LAMBDA_URI="arn:aws:apigateway:${AWS_REGION}:lambda:path/2015-03-31/functions/${LAMBDA_ARN}/invocations"

  aws apigateway put-integration \
    --rest-api-id "$API_ID" \
    --resource-id "$resource_id" \
    --http-method "$http_method" \
    --type AWS_PROXY \
    --integration-http-method POST \
    --uri "$LAMBDA_URI" \
    --region "$AWS_REGION" > /dev/null 2>&1 || true
}

# Add OPTIONS method for CORS preflight
add_options_method() {
  local resource_id=$1
  aws apigateway put-method \
    --rest-api-id "$API_ID" \
    --resource-id "$resource_id" \
    --http-method OPTIONS \
    --authorization-type NONE \
    --region "$AWS_REGION" > /dev/null 2>&1 || true

  local LAMBDA_URI="arn:aws:apigateway:${AWS_REGION}:lambda:path/2015-03-31/functions/${LAMBDA_ARN}/invocations"
  aws apigateway put-integration \
    --rest-api-id "$API_ID" \
    --resource-id "$resource_id" \
    --http-method OPTIONS \
    --type AWS_PROXY \
    --integration-http-method POST \
    --uri "$LAMBDA_URI" \
    --region "$AWS_REGION" > /dev/null 2>&1 || true
}

echo "   Configuring /submit endpoint..."
SUBMIT_RESOURCE_ID=$(create_or_get_resource "submit")
add_method_integration "$SUBMIT_RESOURCE_ID" "POST"
add_options_method "$SUBMIT_RESOURCE_ID"

echo "   Configuring /stats endpoint..."
STATS_RESOURCE_ID=$(create_or_get_resource "stats")
add_method_integration "$STATS_RESOURCE_ID" "GET"
add_options_method "$STATS_RESOURCE_ID"

# ── Step 7: Grant API Gateway permission to invoke Lambda ─────────────────────
echo "→ Granting API Gateway permission to invoke Lambda..."
aws lambda add-permission \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --statement-id "apigateway-invoke-$(date +%s)" \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:${AWS_REGION}:${ACCOUNT_ID}:${API_ID}/*/*" \
  --region "$AWS_REGION" > /dev/null 2>&1 || echo "   (Permission may already exist — continuing)"

# ── Step 8: Deploy the API ────────────────────────────────────────────────────
echo "→ Deploying API to stage: $STAGE_NAME"
aws apigateway create-deployment \
  --rest-api-id "$API_ID" \
  --stage-name "$STAGE_NAME" \
  --region "$AWS_REGION" > /dev/null

API_URL="https://${API_ID}.execute-api.${AWS_REGION}.amazonaws.com/${STAGE_NAME}"

echo ""
echo "✅ Backend deployment complete!"
echo ""
echo "   API Gateway URL: $API_URL"
echo ""
echo "   Next steps:"
echo "   1. Copy the API URL above"
echo "   2. Set it as REACT_APP_API_BASE in your environment"
echo "   3. Run ./scripts/deploy-frontend.sh to deploy the frontend"
echo ""
