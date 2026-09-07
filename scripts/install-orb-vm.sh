#!/usr/bin/env bash
# ============================================================================
# Lububble — OrbStack VM bring-up (dev PoC of the future OpenStack/cloud image)
# ============================================================================
# Installs a fresh Ubuntu VM with: docker, a fresh hermes install (NO personal
# keys), the lububble orchestration stack, and exposes:
#   - orchestrator API on :3001
#   - builder web UI on :5173 (vite dev server)
#   - per-project preview ports 14000.. (opened by generated compose stacks)
# Personal LLM keys are NEVER baked in: the provider is set
#   a) at build time: LUBUBBLE_LLM_BASE_URL/LUBUBBLE_LLM_API_KEY/LUBUBBLE_LLM_MODEL
#   b) at runtime, from outstde the VM: PUT /api/config (see below)
# The orchestrator merges the provider into the lububble hermes profile
# (config.yaml + key_env) on every agent spawn, so either path works and the
# key can be ROTATED anytime via the same PUT.
# ============================================================================
set -euo pipefail

VM_NAME="${LUBUBBLE_VM_NAME:-lububble-vm}"
REPO_SRC="${LUBUBBLE_SRC:-$HOME/lububble}"
HERMES_SRC="${LUBUBBLE_HERMES_SRC:-$HOME/.hermes/hermes-agent}"

run_vm() { orb -m "$VM_NAME" -u root bash -c "$1"; }

orbctl create ubuntu:22.04 "$VM_NAME" 2>/dev/null || true

echo "--- packages: docker, node 22, uv, ripgrep"
run_vm "DEBIAN_FRONTEND=noninteractive apt-get remove -y --purge libnode-dev >/dev/null 2>&1 || true"
run_vm "apt-get update >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 curl git ripgrep >/dev/null"
orb -m "$VM_NAME" -u root bash -c "curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1 && apt-get install -y nodejs >/dev/null && node --version"
run_vm "curl -LsSf https://astral.sh/uv/install.sh | bash >/dev/null 2>&1 || true"

echo "--- hermes: install FRESH from host source (secrets excluded)"
tar cf - --exclude='hermes-agent/venv' --exclude='hermes-agent/auth.json' \
    --exclude='hermes-agent/.env' --exclude='hermes-agent/state.db' \
    --exclude='__pycache__' -C ~/.hermes hermes-agent 2>/dev/null \
  | orb -m "$VM_NAME" -u root tar xf - -C /root 2>/dev/null
run_vm "cd /root/.hermes/hermes-agent && ~/.local/bin/uv venv --python 3.13 venv >/dev/null && ~/.local/bin/uv pip install --python ./venv/bin/python -e '.[all]' 2>&1 | tail -1"
run_vm "printf '#!/usr/bin/env bash\nunset PYTHONPATH\nunset PYTHONHOME\nexec /root/.hermes/hermes-agent/venv/bin/python /root/.hermes/hermes-agent/hermes \"\$@\"\n' > /root/.local/bin/hermes && chmod +x /root/.local/bin/hermes"

echo "--- profile: clone from empty default (no keys)"
run_vm "export PATH=~/.local/bin:\$PATH; hermes profile list >/dev/null 2>&1; hermes profile create lububble --clone 2>&1 | tail -1"

echo "--- app source"
( tar cf - --exclude node_modules --exclude dist --exclude .git -C "$(dirname "$REPO_SRC")" "$(basename "$REPO_SRC")" 2>/dev/null \
  | orb -m "$VM_NAME" -u root tar xf - -C /root ) 2>&1 | grep -v LIBARCHIVE || true
run_vm "cd /root/lububble && npm install --no-audit --no-fund >/dev/null && npm run build -w @lububble/mcp-tools -w @lububble/server -w @lububble/web >/dev/null && echo BUILD_OK"

echo "--- runtime key injection (from outside the VM)"
if [[ -n "${LUBUBBLE_LLM_BASE_URL:-}" && -n "${LUBUBBLE_LLM_API_KEY:-}" && -n "${LUBUBBLE_LLM_MODEL:-}" ]]; then
  curl -s "http://lububble-vm.orb.local:3001/api/health" >/dev/null
  curl -s -X PUT "http://lububble-vm.orb.local:3001/api/config" -H 'content-type: application/json' -d "{
    \"config\": {\"providers\": [{\"id\": \"p1\", \"name\": \"build\", \"baseUrl\": \"${LUBUBBLE_LLM_BASE_URL}\",
      \"model\": \"${LUBUBBLE_LLM_MODEL}\", \"apiKey\": \"${LUBUBBLE_LLM_API_KEY}\"}], \"defaultProviderId\": \"p1\"}}"
  echo "provider injected at build time"
fi

echo "--- start orchestrator (UI: http://lububble-vm.orb.local:5173  API: :3001)"
run_vm "cd /root/lububble && (setsid nohup env LUBUBBLE_HERMES_BIN=/root/.local/bin/hermes LUBUBBLE_HOST=0.0.0.0 node server/dist/main.js >/root/server.log 2>&1 &); sleep 1; curl -s localhost:3001/api/health"
run_vm "cd /root/lububble/web && (setsid nohup npx vite --host 0.0.0.0 --port 5173 >/root/vite.log 2>&1 &); sleep 2; curl -s -o /dev/null -w 'vite:%{http_code}\n' localhost:5173"

cat <<EOF

VM ready:
  browser UI   http://lububble-vm.orb.local:5173
  API          http://lububble-vm.orb.local:3001/api/health
  preview      http://lububble-vm.orb.local:14001 (once a project runs)

Set the provider from OUTSIDE your VM at any time (kills pooled agents,
next spawn picks it up — works with any OpenAI-format endpoint):

  curl -X PUT http://lububble-vm.orb.local:3001/api/config \
    -H 'content-type: application/json' -d '{
      "config": {"providers":[{"id":"p1","name":"prod","baseUrl":"https://your-endpoint/v1",
      "model":"your-model","apiKey":"<KEY>"}],"defaultProviderId":"p1"}}'

Nothing about your personal credentials lives inside the VM image unless
you put it there via the API at runtime or LUBUBBLE_LLM_* envs at build.
EOF
