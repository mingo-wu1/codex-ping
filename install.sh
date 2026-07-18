#!/usr/bin/env sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install_dir="${HOME}/.codex-market-board"
skill_dir="${HOME}/.agents/skills/marketboard"
bin_dir="${HOME}/.local/bin"

mkdir -p "$install_dir" "$skill_dir" "$bin_dir"
cp "$repo_dir/marketboard.py" "$install_dir/marketboard.py"
cp "$repo_dir/.agents/skills/marketboard/SKILL.md" "$skill_dir/SKILL.md"

cat > "$bin_dir/marketboard" <<'EOF'
#!/usr/bin/env sh
exec python3 "$HOME/.codex-market-board/marketboard.py" "$@"
EOF
chmod +x "$bin_dir/marketboard"

if [ "${1:-}" != "" ]; then
  python3 "$install_dir/marketboard.py" 服务器 "$1"
fi

printf '%s\n' 'Installed. Ensure ~/.local/bin is on PATH, restart Codex, then say:'
printf '%s\n' '$marketboard 找300元以内的电动牙刷'
