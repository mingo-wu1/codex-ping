#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install_root=${CODEX_BAZAAR_INSTALL_ROOT:-"$HOME/.codex-bazaar"}
skill_root=${CODEX_BAZAAR_SKILL_ROOT:-"$HOME/.agents/skills/codexbazaar"}
relay_server=${1:-"https://codex-ping.mingowu1.workers.dev"}
board_server=${2:-""}
relay_server=${relay_server%/}

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required: https://www.python.org/downloads/" >&2
  exit 1
fi

mkdir -p "$install_root/market" "$skill_root/agents" "$HOME/.codex-ping"
cp "$repo_root/codexping.py" "$install_root/codexping.py"
for file in marketboard.py marketadmin.py package.json package-lock.json wrangler.toml README.md; do
  cp "$repo_root/market/$file" "$install_root/market/$file"
done
for directory in src scripts test-assets; do
  mkdir -p "$install_root/market/$directory"
  cp -R "$repo_root/market/$directory/." "$install_root/market/$directory/"
done
cp "$repo_root/.agents/skills/codexbazaar/SKILL.md" "$skill_root/SKILL.md"
cp "$repo_root/.agents/skills/codexbazaar/agents/openai.yaml" "$skill_root/agents/openai.yaml"

python3 - "$HOME/.codex-ping/config.json" "$relay_server" <<'PY'
import json, os, sys
path, server = sys.argv[1:]
data = {}
if os.path.exists(path):
    with open(path, encoding="utf-8") as file:
        data = json.load(file)
data["server"] = server
with open(path, "w", encoding="utf-8") as file:
    json.dump(data, file, ensure_ascii=False, indent=2)
PY

if [ -n "$board_server" ]; then
  python3 "$install_root/market/marketboard.py" server "$board_server"
fi

echo "Codex Bazaar: $install_root"
echo "Skill:         $skill_root"
echo 'Done. Restart Codex and invoke: $codexbazaar'
