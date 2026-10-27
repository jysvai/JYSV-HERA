#!/usr/bin/env bash
# Launch a packaged HERA in self-test mode and fail unless every check passed.
# usage: scripts/smoke.sh <path to executable> [extra args...]
set -u
exe="$1"; shift
work="$(mktemp -d)"
# Git Bash on Windows: hand the app a C:/... path, not /tmp/...
if command -v cygpath > /dev/null 2>&1; then work="$(cygpath -m "$work")"; fi
export HERA_HOME="$work/home"
export HERA_SMOKE="$work/smoke.json"
mkdir -p "$HERA_HOME"

"$exe" "$@" > "$work/app.log" 2>&1 &
pid=$!

for _ in $(seq 1 150); do
  [ -s "$HERA_SMOKE" ] && break
  kill -0 "$pid" 2>/dev/null || break
  sleep 1
done
sleep 2
kill "$pid" 2>/dev/null || true

if [ ! -s "$HERA_SMOKE" ]; then
  echo "::error::self-test wrote no result"
  tail -n 60 "$work/app.log"
  exit 1
fi

cat "$HERA_SMOKE"
node -e "process.exit(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).ok ? 0 : 1)" "$HERA_SMOKE"
