#!/usr/bin/env sh
# Dedicated port-forward from a local port to the Buntime runtime Service on k8s,
# so the local @buntime/mcp server (and any client) reaches the runtime at a
# STABLE localhost URL — immune to the Service's randomly-assigned NodePort.
#
# Run it in its own terminal and leave it open while you use the MCP. It
# auto-reconnects if the tunnel drops (pod restart, transient network).
#
# Config via env (all optional):
#   BUNTIME_NAMESPACE    k8s namespace          (default: buntime)
#   BUNTIME_SERVICE      k8s service name       (default: buntime)
#   BUNTIME_LOCAL_PORT   local port to bind     (default: 8800)
#   BUNTIME_REMOTE_PORT  service port           (default: 8000)
#   BUNTIME_KUBECONFIG   kubeconfig path        (default: $KUBECONFIG / kubectl default)
#
# Point the MCP at the printed URL: BUNTIME_URL=http://localhost:$BUNTIME_LOCAL_PORT
set -eu

NS="${BUNTIME_NAMESPACE:-buntime}"
SVC="${BUNTIME_SERVICE:-buntime}"
LOCAL_PORT="${BUNTIME_LOCAL_PORT:-8800}"
REMOTE_PORT="${BUNTIME_REMOTE_PORT:-8000}"

if [ -n "${BUNTIME_KUBECONFIG:-}" ]; then
  KUBECONFIG="$BUNTIME_KUBECONFIG"
  export KUBECONFIG
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "[buntime-pf] error: kubectl not found on PATH" >&2
  exit 1
fi

trap 'echo "[buntime-pf] stopped."; exit 0' INT TERM

echo "[buntime-pf] kubeconfig:  ${KUBECONFIG:-<kubectl default>}"
echo "[buntime-pf] forwarding:  localhost:${LOCAL_PORT} -> svc/${SVC}:${REMOTE_PORT} (ns ${NS})"
echo "[buntime-pf] MCP URL:     http://localhost:${LOCAL_PORT}"
echo "[buntime-pf] verify:      curl -s http://localhost:${LOCAL_PORT}/.well-known/buntime"
echo "[buntime-pf] Ctrl-C to stop. Auto-reconnects on drop."

while true; do
  kubectl -n "$NS" port-forward "svc/${SVC}" "${LOCAL_PORT}:${REMOTE_PORT}" || true
  echo "[buntime-pf] tunnel dropped; reconnecting in 2s..." >&2
  sleep 2
done
