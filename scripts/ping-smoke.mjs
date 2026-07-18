import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const root = mkdtempSync(join(tmpdir(), "codex-bazaar-ping-"));
const luffyHome = join(root, "computer-a-luffy");
const hancockHome = join(root, "computer-b-hancock");
const origin = "http://127.0.0.1:8797";
const workerNode = process.env.WORKER_NODE || process.execPath;
const python = process.env.PYTHON || "python";
let worker;

async function waitForRelay() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${origin}/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Ping relay did not become ready");
}

async function client(home, text) {
  const child = spawn(python, [join(repo, "codexping.py"), text, "--base", origin, "--timeout", "2"], {
    cwd: repo,
    env: { ...process.env, HOME: home, USERPROFILE: home, PYTHONUTF8: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  for await (const chunk of child.stdout) stdout += chunk;
  for await (const chunk of child.stderr) stderr += chunk;
  const code = await new Promise((resolve) => child.once("exit", resolve));
  if (code !== 0) throw new Error(`Ping client failed (${text}): ${stderr || stdout}`);
  return stdout.trim();
}

async function status(name) {
  const response = await fetch(`${origin}/status?agent=${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error(`status request failed: ${response.status}`);
  return response.json();
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
}

async function cleanup(path) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!new Set(["EBUSY", "EPERM"]).has(error.code) || attempt === 19) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

try {
  worker = spawn(workerNode, [join(repo, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", "--port", "8797", "--persist-to", join(root, "worker-state")], {
    cwd: repo,
    stdio: ["ignore", "ignore", "inherit"],
  });
  await waitForRelay();
  if (!(await client(luffyHome, "我叫路飞")).includes("已登录 路飞")) throw new Error("Luffy identity failed");
  if (!(await client(hancockHome, "我叫女帝")).includes("已登录 女帝")) throw new Error("Hancock identity failed");

  await client(luffyHome, "女帝你好");
  const unread = await status("女帝");
  if (unread.count !== 1) throw new Error("unread notification count is wrong");
  if ((await client(hancockHome, "收")) !== "你好") throw new Error("direct message body changed");
  if (!(await client(hancockHome, "收")).includes("没有消息")) throw new Error("read message did not burn");

  await client(hancockHome, "路飞在的");
  if ((await client(luffyHome, "收")) !== "在的") throw new Error("reply failed");
  await client(luffyHome, "大家集合");
  if ((await client(hancockHome, "收")) !== "集合") throw new Error("broadcast failed");

  console.log(JSON.stringify({
    ok: true,
    isolatedComputers: 2,
    identities: ["路飞", "女帝"],
    directMessage: true,
    unreadNotification: true,
    burnAfterRead: true,
    reply: true,
    broadcast: true,
  }, null, 2));
} finally {
  await stop(worker);
  await cleanup(root);
}
