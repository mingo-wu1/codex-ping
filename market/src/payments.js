const encoder = new TextEncoder();

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function createStripeCheckout({ order, origin, secretKey, connectedAccount }) {
  if (!secretKey) throw new Error("Stripe is not configured");
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", `${origin}/?payment=success&order=${encodeURIComponent(order.id)}`);
  form.set("cancel_url", `${origin}/?payment=cancelled&order=${encodeURIComponent(order.id)}`);
  form.set("line_items[0][quantity]", String(order.quantity));
  form.set("line_items[0][price_data][currency]", order.currency.toLowerCase());
  form.set("line_items[0][price_data][unit_amount]", String(order.unitPriceMinor));
  form.set("line_items[0][price_data][product_data][name]", order.title);
  form.set("metadata[order_id]", order.id);
  if (connectedAccount) {
    form.set("payment_intent_data[transfer_data][destination]", connectedAccount);
  }
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": `codex-market-board-${order.id}`,
    },
    body: form,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message || "Stripe checkout creation failed");
  return { provider: "stripe", checkoutUrl: result.url, providerReference: result.id };
}

export async function verifyStripeWebhook({ payload, signatureHeader, webhookSecret, toleranceSeconds = 300 }) {
  if (!webhookSecret) throw new Error("Stripe webhook secret is not configured");
  const parts = Object.fromEntries(
    String(signatureHeader || "")
      .split(",")
      .map((part) => part.split("=", 2))
      .filter(([key, value]) => key && value),
  );
  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds) {
    throw new Error("Stripe webhook timestamp is invalid");
  }
  const expected = await hmacHex(webhookSecret, `${timestamp}.${payload}`);
  if (!parts.v1 || parts.v1 !== expected) throw new Error("Stripe webhook signature is invalid");
  return JSON.parse(payload);
}

export function validateStripeCheckoutPayment(session, order) {
  if (session?.payment_status !== "paid") throw new Error("Stripe session is not paid");
  if (session?.metadata?.order_id !== order?.id) throw new Error("Stripe order reference mismatch");
  if (!Number.isInteger(session?.amount_total) || session.amount_total !== order?.totalMinor) {
    throw new Error("Stripe paid amount mismatch");
  }
  if (String(session?.currency || "").toUpperCase() !== String(order?.currency || "").toUpperCase()) {
    throw new Error("Stripe paid currency mismatch");
  }
  if (!session?.id) throw new Error("Stripe session reference is missing");
  return { orderId: order.id, paymentReference: session.id };
}
