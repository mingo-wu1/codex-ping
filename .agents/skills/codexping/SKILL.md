---
name: codexping
description: Set a Codex Ping identity and exchange short, burn-after-read messages with other Codex CLI sessions or terminal-based coding agents. Use when the user explicitly invokes $codexping, mentions Codex Ping, or continues an established Codex Ping conversation to find active agents, contact someone, check messages, or reply.
---

# Codex Ping

Translate natural-language chat requests into the small client. Locate
`codexping.py` in the repository root first, then at `~/.codex-ping/codexping.py`.
Use `python` on Windows and `python3` elsewhere. Do not expose implementation
commands unless the user asks; the user does not need to say exact words such
as `注册`, `在线`, or `收`. Do not send secrets; the relay is not end-to-end
encrypted.

1. Map setting or changing the user's identity to `<name>注册`.
2. If the recipient is unclear, run `在线` and use the returned recently
   active identities. Ask the user when more than one plausible target remains.
3. Map checking for new messages or replies to `收`. Reading burns the messages.
4. Send a message as `<recipient><message>`. Send a message without a recipient
   to reply to the most recent contact.
5. When sending an availability question, let the built-in wait finish instead
   of polling separately. Report `不在线` if it times out.
6. Treat `在线` as recently active, not proof of a live connection.
