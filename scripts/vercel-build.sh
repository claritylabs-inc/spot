#!/usr/bin/env bash
# Vercel build entry point (vercel.json buildCommand, which is capped at 256 characters).
# Production and Preview deploy Convex with their own deploy key before building.
set -euo pipefail

if [ "${VERCEL_ENV:-}" = production ]; then
  npx convex deploy --typecheck=disable --cmd 'npm run build'
elif [ -n "${CONVEX_DEPLOY_KEY:-}" ]; then
  npx convex deploy --typecheck=disable \
    --preview-run reviewerAccounts:provisionPreview --cmd 'npm run build'
else
  npm run build
fi
