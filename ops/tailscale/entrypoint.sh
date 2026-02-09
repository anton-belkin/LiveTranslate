#!/bin/sh
set -eu

STATE_DIR="/var/lib/tailscale"
SOCKET="/var/run/tailscale/tailscaled.sock"
AUTHKEY="${TS_AUTHKEY:-}"
HOSTNAME="${TS_HOSTNAME:-livetranslate}"
SERVE_PORT="${TS_SERVE_PORT:-80}"
SERVE_TARGET="${TS_SERVE_TARGET:-http://caddy:80}"
FUNNEL="${TS_FUNNEL:-true}"

mkdir -p "$STATE_DIR"

tailscaled --state="${STATE_DIR}/tailscaled.state" --socket="$SOCKET" &

wait_for_backend() {
  tries=0
  while [ $tries -lt 30 ]; do
    if tailscale --socket "$SOCKET" status --json >/tmp/ts-status.json 2>/dev/null; then
      state=$(awk -F'"' '/BackendState/ {print $4; exit}' /tmp/ts-status.json || true)
      if [ "$state" = "Running" ]; then
        return 0
      fi
    fi
    tries=$((tries + 1))
    sleep 1
  done
  return 1
}

if [ -n "$AUTHKEY" ]; then
  tailscale --socket "$SOCKET" up --authkey="$AUTHKEY" --hostname="$HOSTNAME" --accept-dns=false --accept-routes=false
else
  tailscale --socket "$SOCKET" up --hostname="$HOSTNAME" --accept-dns=false --accept-routes=false
fi

if ! wait_for_backend; then
  echo "tailscale backend did not become Running; check auth/network" >&2
  exit 1
fi

tries=0
while [ $tries -lt 10 ]; do
  if tailscale --socket "$SOCKET" serve --http="$SERVE_PORT" "$SERVE_TARGET"; then
    break
  fi
  tries=$((tries + 1))
  sleep 2
done

if [ "$FUNNEL" = "true" ]; then
  tries=0
  while [ $tries -lt 10 ]; do
    if tailscale --socket "$SOCKET" funnel "$SERVE_PORT" on; then
      break
    fi
    tries=$((tries + 1))
    sleep 2
  done
fi

tailscale --socket "$SOCKET" status
wait
