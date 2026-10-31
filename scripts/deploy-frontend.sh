#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-frontend.sh
#
# Builds the React app and deploys it to S3 + CloudFront.
# Run this from the project root: ./scripts/deploy-frontend.sh
#
# Prerequisites:
#   - AWS CLI installed and configured
#   - Node.js 18+ installed
#   - REACT_APP_API_BASE must be exported (the API Gateway URL from deploy-backend.sh)
#   - S3_BUCKET_NAME must be exported
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
AWS_REGION="${AWS_REGION:-us-east-1}"
: "${S3_BUCKET_NAME:?Error: S3_BUCKET_NAME is not set. Export it first.}"
: "${REACT_APP_API_BASE:?Error: REACT_APP_API_BASE is not set. Export it first (API Gateway URL).}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$PROJECT_DIR/frontend"

echo ""
echo "=== Temple Relay — Frontend Deployment ==="
echo "Region:  $AWS_REGION"
echo "Bucket:  $S3_BUCKET_NAME"
echo "API URL: $REACT_APP_API_BASE"
echo ""

# ── Step 1: Install frontend dependencies ────────────────────────────────────
echo "→ Installing frontend dependencies..."
cd "$FRONTEND_DIR"
npm install

# ── Step 2: Build the React app ───────────────────────────────────────────────
echo "→ Building React app..."
export REACT_APP_API_BASE
npm run build
echo "   Build complete: $FRONTEND_DIR/build"

# ── Step 3: Create S3 bucket if it doesn't exist ─────────────────────────────
echo "→ Checking S3 bucket..."
if aws s3api head-bucket --bucket "$S3_BUCKET_NAME" --region "$AWS_REGION" > /dev/null 2>&1; then
  echo "   Bucket already exists: $S3_BUCKET_NAME"
else
  echo "   Creating S3 bucket: $S3_BUCKET_NAME"
  if [ "$AWS_REGION" = "us-east-1" ]; then
    aws s3api create-bucket \
      --bucket "$S3_BUCKET_NAME" \
      --region "$AWS_REGION"
  else
    aws s3api create-bucket \
      --bucket "$S3_BUCKET_NAME" \
      --region "$AWS_REGION" \
      --create-bucket-configuration LocationConstraint="$AWS_REGION"
  fi
fi

# ── Step 4: Configure bucket for static website hosting ───────────────────────
echo "→ Configuring S3 static website hosting..."
aws s3 website "s3://$S3_BUCKET_NAME" \
  --index-document index.html \
  --error-document index.html \
  --region "$AWS_REGION"

# ── Step 5: Upload build files ────────────────────────────────────────────────
echo "→ Uploading files to S3..."
# Upload HTML files without caching (so new deployments are always served)
aws s3 sync "$FRONTEND_DIR/build" "s3://$S3_BUCKET_NAME" \
  --region "$AWS_REGION" \
  --delete \
  --exclude "static/*" \
  --cache-control "no-cache, no-store, must-revalidate"

# Upload static assets with long cache (they have content hashes in filenames)
aws s3 sync "$FRONTEND_DIR/build/static" "s3://$S3_BUCKET_NAME/static" \
  --region "$AWS_REGION" \
  --cache-control "public, max-age=31536000, immutable"

echo "   Upload complete."

# ── Step 6: Set up CloudFront distribution ────────────────────────────────────
echo "→ Checking CloudFront distribution..."

EXISTING_DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Origins.Items[0].DomainName=='${S3_BUCKET_NAME}.s3-website-${AWS_REGION}.amazonaws.com'].Id | [0]" \
  --output text 2>/dev/null || echo "None")

if [ "$EXISTING_DIST_ID" = "None" ] || [ -z "$EXISTING_DIST_ID" ]; then
  echo "   Creating CloudFront distribution (this takes 5–10 minutes)..."

  DIST_CONFIG=$(cat <<EOF
{
  "CallerReference": "temple-relay-$(date +%s)",
  "Comment": "Temple Relay frontend",
  "DefaultCacheBehavior": {
    "TargetOriginId": "S3-temple-relay",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 2,
      "Items": ["GET", "HEAD"]
    },
    "ForwardedValues": {
      "QueryString": false,
      "Cookies": { "Forward": "none" }
    },
    "MinTTL": 0,
    "DefaultTTL": 86400,
    "MaxTTL": 31536000
  },
  "Origins": {
    "Quantity": 1,
    "Items": [{
      "Id": "S3-temple-relay",
      "DomainName": "${S3_BUCKET_NAME}.s3-website-${AWS_REGION}.amazonaws.com",
      "CustomOriginConfig": {
        "HTTPPort": 80,
        "HTTPSPort": 443,
        "OriginProtocolPolicy": "http-only"
      }
    }]
  },
  "CustomErrorResponses": {
    "Quantity": 1,
    "Items": [{
      "ErrorCode": 404,
      "ResponsePagePath": "/index.html",
      "ResponseCode": "200",
      "ErrorCachingMinTTL": 0
    }]
  },
  "Enabled": true,
  "DefaultRootObject": "index.html",
  "PriceClass": "PriceClass_100",
  "HttpVersion": "http2"
}
EOF
)

  DIST_RESULT=$(aws cloudfront create-distribution \
    --distribution-config "$DIST_CONFIG" \
    --query 'Distribution.[Id,DomainName]' \
    --output text)

  DIST_ID=$(echo "$DIST_RESULT" | awk '{print $1}')
  DIST_DOMAIN=$(echo "$DIST_RESULT" | awk '{print $2}')

  echo "   Distribution ID: $DIST_ID"
  echo "   Domain: $DIST_DOMAIN"
  echo "   Note: CloudFront may take 5–10 minutes to fully deploy."
else
  echo "   Found existing distribution: $EXISTING_DIST_ID"
  DIST_DOMAIN=$(aws cloudfront get-distribution \
    --id "$EXISTING_DIST_ID" \
    --query 'Distribution.DomainName' \
    --output text)
  echo "   Domain: $DIST_DOMAIN"

  echo "→ Invalidating CloudFront cache..."
  aws cloudfront create-invalidation \
    --distribution-id "$EXISTING_DIST_ID" \
    --paths "/*" > /dev/null
  echo "   Cache invalidation submitted."
fi

echo ""
echo "✅ Frontend deployment complete!"
echo ""
echo "   Your site will be available at:"
echo "   https://$DIST_DOMAIN"
echo ""
echo "   (CloudFront distributions take 5–10 minutes to fully propagate.)"
echo ""
