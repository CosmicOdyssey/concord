#!/usr/bin/env bash
# Keeps a Cloudflare quick tunnel to the local app alive and publishes its current URL to the gh-pages branch, so
# https://cosmicodyssey.github.io/concord/ always forwards to the live demo. Quick tunnels get a new random URL on
# every start and are dropped by Cloudflare after a disconnect (laptop sleep, network change); this restarts them.
#
#   bash scripts/demo/tunnel-watchdog.sh        # needs the app on :4173 (vite preview) and an authenticated gh CLI
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CF="$ROOT/data/work/tunnel/cloudflared.exe"
RUN_LOG="$ROOT/data/logs/tunnel-run.log"
LOG="$ROOT/data/logs/tunnel.log"
REPO=CosmicOdyssey/concord
PORT=${PORT:-4173}

publish() {  # $1 = tunnel URL ("" = offline)
  local body sha
  body=$(printf '{"url":"%s","updated":"%s"}\n' "$1" "$(date -u +%FT%TZ)" | base64 -w0)
  sha=$(gh api "repos/$REPO/contents/tunnel.json?ref=gh-pages" -q .sha 2>/dev/null || true)
  if gh api -X PUT "repos/$REPO/contents/tunnel.json" -f message="Live demo URL" -f branch=gh-pages \
      -f content="$body" ${sha:+-f sha="$sha"} >/dev/null; then
    echo "$(date -u +%T) published ${1:-offline}"
  else
    echo "$(date -u +%T) publish failed"
  fi
}

while true; do
  : > "$RUN_LOG"
  "$CF" tunnel --no-autoupdate --url "http://localhost:$PORT" --http-host-header "localhost:$PORT" >>"$RUN_LOG" 2>&1 &
  pid=$!
  url=""
  for _ in $(seq 60); do
    url=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$RUN_LOG" | head -1)
    [ -n "$url" ] && break
    sleep 1
  done
  if [ -z "$url" ]; then
    echo "$(date -u +%T) no tunnel URL (offline?); retrying"
  else
    echo "$(date -u +%T) tunnel up: $url"
    publish "$url"
    sleep 30
    fails=0
    while kill -0 "$pid" 2>/dev/null; do
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url/api/health" || true)
      if [ "$code" = "200" ]; then fails=0; else fails=$((fails + 1)); fi
      if grep -q "Tunnel not found" "$RUN_LOG" || [ "$fails" -ge 6 ]; then
        echo "$(date -u +%T) tunnel lost (health $code, $fails failures); restarting"
        break
      fi
      sleep 30
    done
  fi
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  cat "$RUN_LOG" >> "$LOG"
  sleep 10
done
