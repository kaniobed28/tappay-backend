#!/usr/bin/env bash
#
# Trigger a Render deploy via a Deploy Hook, then wait for the service to come back healthy.
#
# One-time setup — get the hook URL from Render:
#   Dashboard -> tappay-api -> Settings -> Deploy Hook -> copy the URL.
# Then provide it either as an env var:
#   export RENDER_DEPLOY_HOOK='https://api.render.com/deploy/srv-...?key=...'
# or save it (gitignored) to backend/scripts/.render-deploy-hook :
#   echo 'https://api.render.com/deploy/srv-...?key=...' > scripts/.render-deploy-hook
#
# Usage:  ./scripts/render-deploy.sh
#
set -euo pipefail

HOOK="${RENDER_DEPLOY_HOOK:-}"
HOOK_FILE="$(dirname "$0")/.render-deploy-hook"
if [ -z "$HOOK" ] && [ -f "$HOOK_FILE" ]; then
  HOOK="$(tr -d ' \t\r\n' < "$HOOK_FILE")"
fi
if [ -z "$HOOK" ]; then
  echo "ERROR: no deploy hook. Set RENDER_DEPLOY_HOOK or create $HOOK_FILE" >&2
  echo "       (Render dashboard -> tappay-api -> Settings -> Deploy Hook)" >&2
  exit 1
fi

HEALTH="${RENDER_HEALTH_URL:-https://tappay-api.onrender.com/api/health}"

echo "==> Triggering Render deploy..."
curl -fsS -X POST "$HOOK" >/dev/null
echo "    Deploy triggered."

echo "==> Waiting for the service to boot (build + migrate deploy can take ~3-5 min)..."
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -m 90 -w '%{http_code}' "$HEALTH" || echo 000)
  echo "    check $i: health HTTP $code"
  if [ "$code" = "200" ]; then
    echo "==> Service healthy: $HEALTH"
    exit 0
  fi
  sleep 15
done

echo "==> TIMEOUT: service did not report healthy in time. Check the Render dashboard logs." >&2
exit 1
