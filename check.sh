#!/usr/bin/env bash
# 语法自检：和 CI 跑的是同一条命令
set -e
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "[x] Node.js not found. Install Node 18+"; exit 1; }
node --check server.mjs
node --check public/app.js
echo "[ok] syntax check passed"
