#!/usr/bin/env bash
# macOS / Linux launcher
set -e
cd "$(dirname "$0")"
export PORT="${PORT:-7788}"
if ! command -v node >/dev/null 2>&1; then
  echo "[x] Node.js not found. Install Node 18+ from https://nodejs.org"
  exit 1
fi
node server.mjs
