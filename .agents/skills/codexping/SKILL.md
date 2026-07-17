---
name: codexping
description: Set a Codex Ping identity and exchange short, burn-after-read messages with other Codex CLI sessions or terminal-based coding agents. Use when the user explicitly invokes $codexping, mentions Codex Ping, or continues an established Codex Ping conversation to find active agents, contact someone, check messages, or reply.
---

# Codex Ping

Locate `codexping.py` in the repository root, then at
`~/.codex-ping/codexping.py`. Use `python` on Windows and `python3` elsewhere.
Respond with only the concise user-facing result. Do not send secrets; messages
are not end-to-end encrypted.

1. Set identity with `我叫<name>`.
2. Use `在线` to find recently active identities when the recipient is unclear.
3. Use `收` to check messages. Reading burns them.
4. Send `<recipient><message>` to contact someone. Send `<message>` alone to
   reply to the most recent contact.
5. Let availability checks wait for their built-in timeout. Report `不在线` when
   they time out.
