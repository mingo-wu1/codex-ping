# Codex Ping

Tiny burn-after-read chat for Codex sessions. Two computers can talk through
the included public relay—no Cloudflare account, server setup, npm install, or
chat commands required.

## Quick start

Clone this repository on each computer:

```bash
git clone https://github.com/mingo-wu1/codex-ping.git
cd codex-ping
```

No Git? Choose **Code → Download ZIP** on GitHub, extract it, and open the
folder in Codex.

If you open this folder in Codex, the repository Skill is discovered
automatically. Start a new task and talk naturally:

```text
$codexping 我叫大明
看看谁在线
问小明在不在
看看有没有新消息
回复他：在的
```

That is all. Python 3 is the only requirement.

## Use it from any project

Install the client and Skill once, then Codex Ping works from every project.

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

macOS or Linux:

```bash
sh install.sh
```

Start a new Codex task after installation. The installer copies the Skill to
`~/.agents/skills/codexping` and the client to `~/.codex-ping`; users do not
need to manage or run those files directly.

In a new task, invoke it unambiguously with `$codexping`:

```text
$codexping 我叫大明
$codexping 看看消息
```

After Codex Ping is established in the current task, shorter follow-ups such as
“看看消息” or “回复他：在的” work naturally.

## Two-computer example

On computer A, start with:

```text
$codexping 我叫大明。问小明在不在。
```

On computer B, start with:

```text
$codexping 我叫小明。看看有没有新消息，然后回复他：在的。
```

Both computers use the public relay by default. Identities are local, so use a
different name on each computer.

## Optional: run your own relay

Most users can skip this section. Self-hosting requires a Cloudflare account
and Node.js 22 or newer:

```bash
npm install
npx wrangler login
npx wrangler deploy
```

Wrangler prints the new server URL. The server owner sends that URL to every
participant, and each participant installs it permanently:

```powershell
.\install.ps1 -Server https://your-worker.workers.dev
```

macOS or Linux:

```bash
sh install.sh https://your-worker.workers.dev
```

Both computers must use the same server URL. The installer saves it in
`~/.codex-ping/config.json`, so it is not necessary to set it again. For a
temporary override, use `CODEX_PING_BASE`:

```bash
export CODEX_PING_BASE=https://your-worker.workers.dev
```

PowerShell:

```powershell
$env:CODEX_PING_BASE="https://your-worker.workers.dev"
```

## Privacy and behavior

- `在线` means recently active, not a guaranteed live connection.
- Reading burns messages from that recipient's inbox.
- Availability questions wait up to 2 minutes for a reply.
- Unread messages are stored durably for up to 1 hour and survive Worker
  restarts until they are read or expire.
- Messages to unknown recipients are rejected instead of silently queued.
- The public relay is not end-to-end encrypted. Do not send secrets.
