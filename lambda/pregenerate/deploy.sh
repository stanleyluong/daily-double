#!/bin/bash
# Rebuilds and redeploys the daily-double-pregenerate Lambda. Run this after
# any change to handler.ts or to src/lib/jeopardy.ts / src/lib/firebaseAdmin.ts
# (the handler bundles those directly, so it can drift from the deployed Amplify
# app if generation logic changes and this isn't redeployed too).
set -euo pipefail
cd "$(dirname "$0")"

npm install --no-audit --no-fund

npx --yes esbuild handler.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=cjs \
  --tsconfig=../../tsconfig.json \
  --packages=external \
  --outfile=dist/index.js

rm -rf package function.zip
mkdir package
cp dist/index.js package/index.js
cp -R node_modules package/node_modules
(cd package && zip -r -q ../function.zip . -x "*.DS_Store")

aws lambda update-function-code \
  --function-name daily-double-pregenerate \
  --zip-file fileb://function.zip \
  --region us-west-2 \
  --query '{FunctionName:FunctionName,LastUpdateStatus:LastUpdateStatus,CodeSha256:CodeSha256}' \
  --output json

echo "Deployed. Env vars (ANTHROPIC_API_KEY, FIREBASE_SERVICE_ACCOUNT_BASE64) are managed separately —"
echo "see README.md if they need to be rotated/updated."
