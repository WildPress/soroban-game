#!/usr/bin/env bash
set -euo pipefail

jscadui_dir="${JSCADUI_DIR:-/tmp/jscadui}"
jscadui_port="${JSCADUI_PORT:-5120}"
app_dir="${jscadui_dir}/apps/jscad-web"

if [[ ! -d "$app_dir" ]]; then
  cat >&2 <<MSG
Missing jscadui checkout at ${jscadui_dir}.
Clone it with:
  git clone https://github.com/hrgdavor/jscadui.git ${jscadui_dir}
  npm install --prefix ${jscadui_dir}
MSG
  exit 1
fi

cp -a public/soroban-cad.jscad.js "${app_dir}/static/soroban-cad.jscad.js"
npm --prefix "$app_dir" start -- --port="${jscadui_port}"
