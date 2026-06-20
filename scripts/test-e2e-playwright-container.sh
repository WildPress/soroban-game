#!/usr/bin/env bash
set -euo pipefail

container="${PLAYWRIGHT_CONTAINER:-playwright}"
host_ip="${E2E_HOST_IP:-172.17.0.1}"
app_port="${E2E_APP_PORT:-5175}"
app_url="${APP_URL:-http://${host_ip}:${app_port}/}"
cad_url="${CAD_URL:-http://${host_ip}:5120/#./soroban-cad.jscad.js}"
artifact_dir="${E2E_ARTIFACT_DIR:-.tmp-test/e2e}"
container_artifact_dir="/tmp/soroban-e2e"
started_app_pid=""

mkdir -p "$artifact_dir"

cleanup() {
  if [[ -n "$started_app_pid" ]]; then
    kill "$started_app_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

docker exec "$container" bash -lc "NODE_PATH=/home/pwuser/node_modules node -e \"require('playwright')\"" >/dev/null

if ! docker exec "$container" bash -lc "curl -fsSI '$app_url' >/dev/null" >/dev/null 2>&1; then
  echo "Starting app dev server on 0.0.0.0:${app_port} for Playwright container access"
  npm run dev -- --host 0.0.0.0 --port "$app_port" --strictPort >"${artifact_dir}/vite-app.log" 2>&1 &
  started_app_pid="$!"

  for _ in {1..60}; do
    if docker exec "$container" bash -lc "curl -fsSI '$app_url' >/dev/null" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
fi

docker exec "$container" bash -lc "curl -fsSI '$app_url' >/dev/null"
docker exec "$container" bash -lc "curl -fsSI '${cad_url%%#*}' >/dev/null"

docker exec "$container" bash -lc "rm -rf '$container_artifact_dir' && mkdir -p '$container_artifact_dir'"
docker cp test/e2e/soroban.e2e.cjs "$container:/tmp/soroban.e2e.cjs"
docker exec \
  -e NODE_PATH=/home/pwuser/node_modules \
  -e APP_URL="$app_url" \
  -e CAD_URL="$cad_url" \
  -e E2E_ARTIFACT_DIR="$container_artifact_dir" \
  "$container" \
  bash -lc "node /tmp/soroban.e2e.cjs"

docker cp "$container:$container_artifact_dir/." "$artifact_dir/"
echo "E2E artifacts written to ${artifact_dir}"
