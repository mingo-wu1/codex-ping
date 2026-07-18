import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createCheckoutQr, decodeCheckoutQr } from "../src/payment-qr.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repo = dirname(scriptDir);
const root = mkdtempSync(join(tmpdir(), "codex-bazaar-commerce-"));
const qrPath = join(root, "development-checkout-qr.png");
const origin = "http://127.0.0.1:8796";
const workerNode = process.env.WORKER_NODE || process.execPath;
const python = process.env.PYTHON || "python";
let worker;

async function request(path, { method = "GET", body, token, admin, contentType = "application/json" } = {}) {
  const headers = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (admin) headers["x-admin-token"] = admin;
  let payload = body;
  if (body !== undefined && contentType === "application/json") {
    headers["content-type"] = contentType;
    payload = JSON.stringify(body);
  } else if (contentType) headers["content-type"] = contentType;
  const response = await fetch(`${origin}${path}`, { method, headers, body: payload });
  const value = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${value.error || response.status}`);
  return value;
}

async function waitForWorker() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("market Worker did not become ready");
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
}

async function clientCommand(home, text) {
  const child = spawn(python, [join(repo, "marketboard.py"), text], {
    cwd: repo,
    env: { ...process.env, CODEX_MARKET_HOME: home, PYTHONUTF8: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  for await (const chunk of child.stdout) stdout += chunk;
  for await (const chunk of child.stderr) stderr += chunk;
  const code = await new Promise((resolve) => child.once("exit", resolve));
  if (code !== 0) throw new Error(`buyer command failed (${text}): ${stderr || stdout}`);
  return stdout.trim();
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
  worker = spawn(workerNode, [join(repo, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", "--port", "8796", "--persist-to", join(root, "worker-state"), "--var", "ADMIN_TOKEN:commerce-test-admin", "--var", "ALLOW_MOCK_PAYMENTS:true", "--var", "ALLOW_DEMO_AUTO_APPROVAL:true"], {
    cwd: repo,
    stdio: ["ignore", "ignore", "inherit"],
  });
  await waitForWorker();

  const merchantResult = await request("/api/merchants", {
    method: "POST",
    body: { displayName: "Hancock Store", entityType: "individual", operatingRegions: ["CN"] },
  });
  const merchant = merchantResult.merchant;
  const merchantToken = merchantResult.merchantToken;
  if (merchant.status !== "active" || merchant.verificationLevel !== "demo-only") throw new Error("demo merchant was not auto-approved and labelled clearly");

  const productImage = readFileSync(join(repo, "test-assets", "electric-toothbrush.png"));
  const uploaded = await request(`/api/images?merchant=${merchant.id}`, {
    method: "POST", token: merchantToken, body: productImage, contentType: "image/png",
  });
  const imageResponse = await fetch(uploaded.url);
  const fetchedImage = Buffer.from(await imageResponse.arrayBuffer());
  if (!imageResponse.ok || !fetchedImage.equals(productImage)) throw new Error("uploaded product image did not round-trip exactly");

  const listingResult = await request("/api/listings", {
    method: "POST",
    token: merchantToken,
    body: {
      merchantId: merchant.id,
      title: "Sonic electric toothbrush",
      summary: "Soft bristles, two-minute timer, USB-C charging base",
      category: "personal-care",
      priceMinor: 16900,
      currency: "CNY",
      shippingRegions: ["CN"],
      images: [uploaded.url],
    },
  });
  const listing = listingResult.listing;
  if (listing.compliance.status !== "active" || listing.compliance.policyId !== "demo-only") throw new Error("demo listing was not auto-approved and labelled clearly");

  const search = await request("/api/listings?q=toothbrush&max_price_minor=20000&currency=CNY&ship_to=CN&sort=price");
  if (!search.listings.some((item) => item.id === listing.id)) throw new Error("buyer could not discover the listing");
  const preview = (await request("/api/orders/preview", { method: "POST", body: { listingId: listing.id, quantity: 1 } })).preview;
  if (preview.totalMinor !== 16900 || preview.currency !== "CNY") throw new Error("order preview changed the agreed total");

  const orderResult = await request("/api/orders", {
    method: "POST",
    body: { listingId: listing.id, quantity: 1, buyerId: "Luffy", buyerConfirmed: true },
  });
  const order = orderResult.order;
  const orderToken = orderResult.orderToken;
  const buyerHome = join(root, "buyer-client");
  mkdirSync(buyerHome, { recursive: true });
  writeFileSync(join(buyerHome, "config.json"), JSON.stringify({
    server: origin,
    buyerId: "Luffy",
    orders: { [order.id]: orderToken },
  }, null, 2), "utf8");
  const payOutput = await clientCommand(buyerHome, `付款 ${order.id}`);
  if (!payOutput.includes("开发测试二维码，不会扣真实资金")) throw new Error("buyer was not warned that the QR is simulated");
  const buyerConfig = JSON.parse(readFileSync(join(buyerHome, "config.json"), "utf8"));
  const checkout = buyerConfig.paymentSessions[order.id];
  if (checkout.provider !== "mock") throw new Error("test checkout was not clearly marked mock");
  const qrSvgPath = join(buyerHome, `${order.id}-checkout.svg`);
  if (!existsSync(qrSvgPath) || !readFileSync(qrSvgPath, "utf8").startsWith("<svg")) throw new Error("buyer client did not save the checkout QR SVG");

  const qr = await createCheckoutQr(checkout.checkoutUrl);
  writeFileSync(qrPath, qr);
  const scannedUrl = decodeCheckoutQr(qr);
  if (scannedUrl !== checkout.checkoutUrl) throw new Error("scanned QR changed the checkout URL");
  const scan = new URL(scannedUrl);
  const secret = scan.searchParams.get("secret");
  if (!secret) throw new Error("simulated checkout QR did not contain a payment session");
  const claimOutput = await clientCommand(buyerHome, `我已付款 ${order.id}`);
  if (!claimOutput.includes("paid（simulated）")) throw new Error("natural-language payment claim was not acknowledged");
  const paid = await request(`/api/orders/${order.id}`, { token: orderToken });
  if (paid.order.status !== "paid" || paid.order.paymentVerification !== "simulated") throw new Error("simulated payment was not recorded clearly");

  const merchantHome = join(root, "merchant-client");
  mkdirSync(merchantHome, { recursive: true });
  writeFileSync(join(merchantHome, "config.json"), JSON.stringify({
    server: origin,
    merchant: { id: merchant.id, token: merchantToken },
    orders: {},
  }, null, 2), "utf8");
  const merchantOrders = await clientCommand(merchantHome, "商家订单");
  if (!merchantOrders.includes("Sonic electric toothbrush") || !merchantOrders.includes("paid (simulated)")) throw new Error("merchant did not receive the simulated paid status");
  if (!((await clientCommand(merchantHome, `接单 ${order.id}`)).includes("accepted"))) throw new Error("merchant acceptance failed");
  if (!((await clientCommand(merchantHome, `已发货 ${order.id}`)).includes("fulfilled"))) throw new Error("merchant fulfilment failed");
  if (!((await clientCommand(buyerHome, `确认收货 ${order.id}`)).includes("completed"))) throw new Error("buyer completion failed");
  const comment = await request(`/api/listings/${listing.id}/comments`, {
    method: "POST", token: orderToken, body: { orderId: order.id, authorId: "Luffy", body: "Verified purchase comment" },
  });
  const detail = (await request(`/api/listings/${listing.id}`)).listing;
  if (comment.comment.verifiedPurchase || !comment.comment.simulatedPurchase || detail.ranking.explanation.completedOrders !== 0) {
    throw new Error("simulated transaction polluted verified commerce data");
  }

  console.log(JSON.stringify({
    ok: true,
    environment: "development-only-no-real-money",
    productImageBytes: productImage.length,
    productImageRoundTrip: true,
    listingDiscovered: true,
    buyerConfirmedExactTotal: preview.totalMinor,
    checkoutProvider: checkout.provider,
    qrPngBytes: qr.length,
    checkoutQrSvg: true,
    qrDecodedExactly: true,
    paymentStatus: paid.order.status,
    paymentVerification: paid.order.paymentVerification,
    merchantSawPaidStatus: true,
    merchantAccepted: true,
    merchantFulfilled: true,
    buyerCompleted: true,
    simulatedPurchaseComment: comment.comment.simulatedPurchase,
    excludedFromVerifiedRanking: true,
    completedOrdersInRanking: detail.ranking.explanation.completedOrders,
  }, null, 2));
} finally {
  await stop(worker);
  await cleanup(root);
}
