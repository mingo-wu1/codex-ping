# Codex Ping

A tiny burn-after-read message relay for Codex CLI sessions and other
terminal-based coding agents.

`codexping` lets two terminal sessions exchange short messages through a
Cloudflare relay. A person or coding agent invokes the `./hw` command to send
and receive messages; this is a standalone CLI tool, not a built-in Codex
feature. There are no accounts, friends lists, databases, or chat histories.
Messages disappear after they are read.

```text
./hw 小明在吗？
在吗？
在的
```

See recently active identities before choosing a recipient:

```bash
./hw 在线
./hw 在线 --json
```

## Quick Start

Clone and install:

```bash
git clone https://github.com/mingo-wu1/codex-ping.git
cd codex-ping
npm install
```

Deploy your own relay:

```bash
npx wrangler login
npx wrangler deploy
```

Use the printed `workers.dev` URL as `BASE` in `codexping.py` if you deploy to a
different address, or set `CODEX_PING_BASE` without editing the source:

```bash
export CODEX_PING_BASE=https://your-worker.workers.dev
```

## Chat

Person A:

```bash
./hw 大明注册
./hw 小明在吗？
```

Person B:

```bash
./hw 小明注册
./hw 收
./hw 在的
```

Person A sees:

```text
在吗？
在的
```

If B does not reply within 2 minutes, A sees:

```text
不在线
```

After someone talks to you, you can reply without naming them:

```bash
./hw 在的
```

## Rules

- `名字注册` sets your local identity and announces you to the relay.
- `收` reads your inbox. Read messages are deleted.
- `在线`, `谁在`, or `who` lists recently active identities.
- Add `--json` to `在线` or `收` for agent-friendly structured output.
- `小明在吗？` sends `在吗？` to 小明 and waits up to 2 minutes.
- `在的` replies to the last person.
- The 2-minute wait controls how long the sender waits for an immediate reply;
  unread messages can remain on the relay for up to 1 hour.
- This uses a Cloudflare relay and is not direct peer-to-peer communication.
- Messages are not end-to-end encrypted. Do not send secrets.

## Files

- `codexping.py`: tiny chat client
- `hw`: short launcher
- `hw.cmd`: Windows launcher
- `cloudflare-worker.js`: Cloudflare Durable Object relay
- `wrangler.toml`: deployment config

## Codex Skill

The small skill in `skills/codex-ping` teaches Codex to discover active
identities and use the existing `./hw` commands. Copy that folder into your
Codex skills directory to install it.
