import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { validateStripeCheckoutPayment, verifyStripeWebhook } from "./payments.js";

test("Stripe webhook verification accepts a valid signed payload", async () => {
  const secret = "whsec_test";
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_test" } } });
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const event = await verifyStripeWebhook({
    payload,
    signatureHeader: `t=${timestamp},v1=${signature}`,
    webhookSecret: secret,
  });
  assert.equal(event.type, "checkout.session.completed");
});

test("Stripe webhook verification rejects tampering", async () => {
  const timestamp = Math.floor(Date.now() / 1000);
  await assert.rejects(
    verifyStripeWebhook({
      payload: '{"changed":true}',
      signatureHeader: `t=${timestamp},v1=bad`,
      webhookSecret: "whsec_test",
    }),
    /signature is invalid/,
  );
});

test("Stripe payment is bound to the exact order, amount, and currency", () => {
  const order = { id: "ord_123", totalMinor: 16900, currency: "CNY" };
  const session = { id: "cs_123", payment_status: "paid", amount_total: 16900, currency: "cny", metadata: { order_id: "ord_123" } };
  assert.deepEqual(validateStripeCheckoutPayment(session, order), { orderId: "ord_123", paymentReference: "cs_123" });
  assert.throws(() => validateStripeCheckoutPayment({ ...session, amount_total: 1 }, order), /amount mismatch/);
  assert.throws(() => validateStripeCheckoutPayment({ ...session, currency: "usd" }, order), /currency mismatch/);
  assert.throws(() => validateStripeCheckoutPayment({ ...session, metadata: { order_id: "ord_other" } }, order), /reference mismatch/);
});
