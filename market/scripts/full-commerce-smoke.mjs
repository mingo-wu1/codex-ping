import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  worker = spawn(workerNode, [join(repo, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", "--port", "8796", "--persist-to", join(root, "worker-state"), "--var", "ADMIN_TOKEN:commerce-test-admin", "--var", "ALLOW_MOCK_PAYMENTS:true"], {
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
  await request(`/api/merchants/${merchant.id}/verify`, {
    method: "POST", admin: "commerce-test-admin", body: { level: "basic" },
  });

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
  await request(`/api/listings/${listing.id}/compliance`, {
    method: "POST",
    admin: "commerce-test-admin",
    body: { status: "active", policyId: "cn-general-goods", policyVersion: "test-only" },
  });

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
  const checkout = await request(`/api/orders/${order.id}/checkout`, { method: "POST", token: orderToken, body: { provider: "mock" } });
  if (checkout.provider !== "mock") throw new Error("test checkout was not clearly marked mock");
  if (!checkout.checkoutQrSvg?.startsWith("<svg")) throw new Error("checkout response did not include a QR SVG");

  const qr = await createCheckoutQr(checkout.checkoutUrl);
  writeFileSync(qrPath, qr);
  const scannedUrl = decodeCheckoutQr(qr);
  if (scannedUrl !== checkout.checkoutUrl) throw new Error("scanned QR changed the checkout URL");
  const scan = new URL(scannedUrl);
  const secret = scan.searchParams.get("secret");
  const paid = await request(`/api/mock-pay/${order.id}`, { method: "POST", body: { secret } });
  if (paid.order.status !== "paid") throw new Error("verified development payment was not recorded");

  await request(`/api/orders/${order.id}/status`, { method: "POST", token: merchantToken, body: { status: "accepted" } });
  await request(`/api/orders/${order.id}/status`, { method: "POST", token: merchantToken, body: { status: "fulfilled" } });
  await request(`/api/orders/${order.id}/status`, { method: "POST", token: orderToken, body: { status: "completed", fulfilledOnTime: true } });
  const comment = await request(`/api/listings/${listing.id}/comments`, {
    method: "POST", token: orderToken, body: { orderId: order.id, authorId: "Luffy", body: "Verified purchase comment" },
  });
  const detail = (await request(`/api/listings/${listing.id}`)).listing;
  if (!comment.comment.verifiedPurchase || detail.ranking.explanation.completedOrders !== 1) {
    throw new Error("completed transaction did not affect verified commerce data");
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
    merchantAccepted: true,
    merchantFulfilled: true,
    buyerCompleted: true,
    verifiedPurchaseComment: comment.comment.verifiedPurchase,
    completedOrdersInRanking: detail.ranking.explanation.completedOrders,
  }, null, 2));
} finally {
  await stop(worker);
  await cleanup(root);
}
