import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyStripeWebhook } from "./payments.js";

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
