import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repo = dirname(scriptDir);
const workerNode = process.env.WORKER_NODE || process.execPath;
const root = mkdtempSync(join(tmpdir(), "market-worker-cli-"));
let worker;

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Cloudflare Worker local runtime did not become ready");
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
  worker = spawn(workerNode, [join(repo, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", "--port", "8795", "--persist-to", join(root, "worker-state"), "--var", "ADMIN_TOKEN:local-test-admin", "--var", "ALLOW_MOCK_PAYMENTS:true"], {
    cwd: repo,
    stdio: ["ignore", "ignore", "inherit"],
  });
  await waitForHealth("http://127.0.0.1:8795/api/health");
  const cli = spawn(process.execPath, [join(scriptDir, "cli-install-smoke.mjs")], {
    cwd: repo,
    env: { ...process.env, MARKET_TEST_BOARD: "http://127.0.0.1:8795" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let output = "";
  for await (const chunk of cli.stdout) output += chunk;
  const code = await new Promise((resolve) => cli.once("exit", resolve));
  if (code !== 0) throw new Error(`Worker-backed CLI test exited with ${code}`);
  process.stdout.write(output);
} finally {
  await stop(worker);
  await cleanup(root);
}
