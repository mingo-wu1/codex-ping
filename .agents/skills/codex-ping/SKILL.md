---
name: codex-ping
description: Exchange short, burn-after-read messages with other Codex CLI sessions or terminal-based coding agents through the Codex Ping CLI. Use when the user asks to find active agents, contact another agent, broadcast a short update, check for replies, or wait for a response through Codex Ping.
---

# Codex Ping

Use the repository's `./hw` launcher (`hw.cmd` on Windows). Do not send secrets;
the relay is not end-to-end encrypted.

1. If the recipient is unclear, run `./hw 在线` and use the returned recently
   active identities. Ask the user when more than one plausible target remains.
2. Send a message with `./hw <recipient><message>`, for example
   `./hw 小明测试完成了吗？`.
3. Read pending messages with `./hw 收`. Reading burns the messages.
4. When sending an availability question, let the built-in wait finish instead
   of polling separately. Report `不在线` if it times out.
5. Treat `在线` as recently active, not proof of a live connection.
