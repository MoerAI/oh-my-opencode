#!/usr/bin/env bash
# Live opencode QA for the Kimi K2.8 prompt-routing change (omo #8466).
# Drives a real `opencode serve` with the plugin loaded from source in an
# isolated XDG + HOME sandbox, and reads the Sisyphus and Metis prompts back
# off the server's GET /agent endpoint for each model id under test.
set -euo pipefail

REPO="${1:?repo root required}"
LABEL="${2:-run}"
ROOT="$(mktemp -d -t omo-kimi28-qa.XXXXXX)"
trap 'rm -rf "$ROOT"' EXIT

export XDG_DATA_HOME="$ROOT/data"
export XDG_CONFIG_HOME="$ROOT/config"
export XDG_CACHE_HOME="$ROOT/cache"
export XDG_STATE_HOME="$ROOT/state"
export HOME="$ROOT/home"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_MODELS_FETCH=1
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME/opencode" "$XDG_CACHE_HOME" "$XDG_STATE_HOME" "$HOME/.omo" "$ROOT/project"

cat > "$XDG_CONFIG_HOME/opencode/opencode.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["file://$REPO/packages/omo-opencode/src/index.ts"]
}
EOF

classify() {
  case "$1" in
    *"running on Kimi K2.7"*) echo "kimi-k2-7" ;;
    *"You are Sisyphus - an AI orchestrator from OhMyOpenCode"*) echo "kimi-k2-6" ;;
    *) echo "other" ;;
  esac
}

classify_metis() {
  case "$1" in
    *"Kimi K2.7"*) echo "metis-k2-7" ;;
    *) echo "metis-base" ;;
  esac
}

echo "label=$LABEL repo=$REPO opencode=$(opencode --version)"
echo "sandbox=$ROOT (host XDG + HOME untouched)"

for model in \
  "kimi-for-coding/kimi-for-coding" \
  "kimi-for-coding/kimi-for-coding-highspeed" \
  "moonshotai/kimi-k2.8" \
  "opencode-go/kimi-k2.7-code" \
  "moonshotai/kimi-k2.6" \
  "opencode-go/kimi-k3"; do
  cat > "$HOME/.omo/omo.jsonc" <<EOF
{ "agents": { "sisyphus": { "model": "$model" }, "metis": { "model": "$model" } } }
EOF
  log="$ROOT/serve.log"
  : > "$log"
  (cd "$ROOT/project" && opencode serve --port 0 --hostname 127.0.0.1 >> "$log" 2>&1 & echo $! > "$ROOT/serve.pid")
  PORT=""
  for _ in $(seq 1 60); do
    PORT="$(grep -oE 'http://127\.0\.0\.1:[0-9]+' "$log" | head -1 | grep -oE '[0-9]+$' || true)"
    [ -n "$PORT" ] && break
    sleep 1
  done
  if [ -z "$PORT" ]; then
    echo "model=$model result=server-never-listened"
    kill "$(cat "$ROOT/serve.pid")" 2>/dev/null || true
    continue
  fi
  curl -s --max-time 30 "http://127.0.0.1:$PORT/agent" > "$ROOT/agents.json" || true
  sis="$(jq -r '[.[]|select(.name|test("^Sisyphus - "))][0].prompt // ""' "$ROOT/agents.json")"
  met="$(jq -r '[.[]|select(.name|test("^Metis"))][0].prompt // ""' "$ROOT/agents.json")"
  resolved="$(jq -r '[.[]|select(.name|test("^Sisyphus - "))][0].model | "\(.providerID)/\(.modelID)"' "$ROOT/agents.json")"
  echo "model=$model resolved=$resolved sisyphus=$(classify "$sis") metis=$(classify_metis "$met") sisyphus_bytes=${#sis}"
  kill "$(cat "$ROOT/serve.pid")" 2>/dev/null || true
  wait "$(cat "$ROOT/serve.pid")" 2>/dev/null || true
done
