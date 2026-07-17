#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install_root=${CODEX_PING_INSTALL_ROOT:-"$HOME/.codex-ping"}
skill_root=${CODEX_PING_SKILL_ROOT:-"$HOME/.agents/skills/codexping"}
server=${1:-"https://codex-world-bus.mingowu1.workers.dev"}
server=${server%/}

case "$server" in
  http://*|https://*) ;;
  *) echo 'Server must be a complete http:// or https:// URL.' >&2; exit 1 ;;
esac

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required: https://www.python.org/downloads/" >&2
  exit 1
fi

mkdir -p "$install_root" "$skill_root/agents"
cp "$repo_root/codexping.py" "$install_root/codexping.py"
cp "$repo_root/.agents/skills/codexping/SKILL.md" "$skill_root/SKILL.md"
cp "$repo_root/.agents/skills/codexping/agents/openai.yaml" "$skill_root/agents/openai.yaml"

python3 - "$install_root/config.json" "$server" <<'PY'
import json
import os
import sys

path, server = sys.argv[1:]
data = {}
if os.path.exists(path):
    with open(path, encoding="utf-8") as file:
        data = json.load(file)
data["server"] = server
with open(path, "w", encoding="utf-8") as file:
    json.dump(data, file, ensure_ascii=False, indent=2)
PY

if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 10 \
  "$server/health" >/dev/null; then
  echo 'Relay: online'
else
  echo 'Warning: installed, but the public relay could not be reached.' >&2
fi

echo "Client: $install_root"
echo "Skill:  $skill_root"
echo "Server: $server"
echo 'Done. Start a new Codex task with: $codexping set my identity.'
