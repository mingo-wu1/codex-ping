import test from "node:test";
import assert from "node:assert/strict";
import { createCheckoutQr, decodeCheckoutQr } from "./payment-qr.js";
import { createCheckoutQrSvg } from "./qr-encode.js";

test("development checkout QR round-trips the exact provider URL", async () => {
  const url = "https://checkout.example/pay/order_123?token=not-a-real-payment";
  const png = await createCheckoutQr(url);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(decodeCheckoutQr(png), url);
});

test("checkout QR is also available as an embeddable SVG", async () => {
  const svg = await createCheckoutQrSvg("https://checkout.example/pay/order_123");
  assert.match(svg, /^<svg/);
  assert.match(svg, /viewBox=/);
});

test("checkout QR rejects non-web payment targets", async () => {
  await assert.rejects(createCheckoutQr("javascript:alert(1)"), /HTTP or HTTPS/);
});
