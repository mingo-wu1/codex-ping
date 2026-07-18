import { DurableObject } from "cloudflare:workers";
import { MarketBoard } from "./market.js";
import { BOARD_HTML } from "./ui.js";
import { createStripeCheckout, validateStripeCheckoutPayment, verifyStripeWebhook } from "./payments.js";
import { createCheckoutQrSvg } from "./qr-encode.js";

const encoder = new TextEncoder();

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

async function body(request) {
  const value = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required");
  return value;
}

async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(String(value)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes) {
  let value = "";
  for (const byte of new Uint8Array(bytes)) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function token(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

function bearer(request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export class MarketRoom extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.storage = state.storage;
    this.env = env;
  }

  async load() {
    return new MarketBoard((await this.storage.get("market")) || {});
  }

  async save(board) {
    await this.storage.put("market", board.snapshot());
  }

  async requireAdmin(request) {
    const expected = String(this.env.ADMIN_TOKEN || "");
    const supplied = request.headers.get("x-admin-token") || bearer(request);
    if (!expected || supplied !== expected) throw new Error("admin authorization required");
  }

  async requireMerchant(request, merchantId) {
    const auth = (await this.storage.get("merchantAuth")) || {};
    const supplied = bearer(request);
    if (!supplied || auth[merchantId] !== await digest(supplied)) {
      throw new Error("merchant authorization required");
    }
  }

  async requireOrder(request, orderId) {
    const auth = (await this.storage.get("orderAuth")) || {};
    const supplied = bearer(request) || new URL(request.url).searchParams.get("access_token") || "";
    if (!supplied || auth[orderId] !== await digest(supplied)) throw new Error("order authorization required");
  }

  paymentSigningSecret() {
    const value = String(this.env.PAYMENT_SIGNING_SECRET || this.env.ADMIN_TOKEN || "");
    if (!value) throw new Error("payment signing secret is not configured");
    return value;
  }

  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "authorization, content-type, x-admin-token",
          "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const board = await this.load();

    try {
      if (request.method === "GET" && path === "/api/health") {
        return json({ ok: true, service: "codex-market-board", time: new Date().toISOString() });
      }

      // Protocol mode stores only small signed events and attestations. Product
      // details and images remain at the merchant endpoint referenced by events.
      if (request.method === "POST" && path === "/api/protocol/feeds") {
        const input = await body(request);
        const events = input.events;
        if (!Array.isArray(events) || !events.length || events.length > 1000) throw new Error("events must contain 1..1000 items");
        const merchantId = String(events[0]?.merchantId || "");
        if (!/^[a-f0-9]{64}$/.test(merchantId) || events.some((event) => event?.merchantId !== merchantId)) {
          throw new Error("one valid merchant feed is required");
        }
        const feeds = (await this.storage.get("protocolFeeds")) || {};
        const existing = feeds[merchantId] || [];
        if (events.length < existing.length) throw new Error("feed rollback is not allowed");
        if (existing.some((event, index) => events[index]?.eventHash !== event.eventHash)) {
          throw new Error("published feed must preserve its existing prefix");
        }
        feeds[merchantId] = events;
        await this.storage.put("protocolFeeds", feeds);
        return json({ accepted: events.length, merchantId }, 201);
      }

      if (request.method === "POST" && path === "/api/protocol/attestations") {
        const input = await body(request);
        if (!/^[a-f0-9]{64}$/.test(String(input.attestationHash || ""))) throw new Error("valid attestationHash required");
        const attestations = (await this.storage.get("protocolAttestations")) || {};
        attestations[input.attestationHash] = input;
        await this.storage.put("protocolAttestations", attestations);
        return json({ accepted: true, attestationHash: input.attestationHash }, 201);
      }

      if (request.method === "GET" && path === "/api/protocol/events") {
        const eventHash = url.searchParams.get("hash");
        const feeds = (await this.storage.get("protocolFeeds")) || {};
        const event = Object.values(feeds).flat().find((value) => value.eventHash === eventHash);
        if (!event) return json({ error: "event not found" }, 404);
        return json({ event });
      }

      if (request.method === "GET" && path === "/api/protocol/search") {
        const query = (url.searchParams.get("q") || "").trim().toLocaleLowerCase();
        const feeds = (await this.storage.get("protocolFeeds")) || {};
        const attestations = Object.values((await this.storage.get("protocolAttestations")) || {});
        const selectedFeeds = Object.values(feeds).filter((events) => {
          const latestByListing = new Map();
          for (const event of events) latestByListing.set(event.listingId, event);
          return Array.from(latestByListing.values()).some((event) =>
            event.type !== "LISTING_REVOKED" &&
            (!query || `${event.payload?.name || ""} ${event.payload?.category || ""}`.toLocaleLowerCase().includes(query))
          );
        });
        const hashes = new Set(selectedFeeds.flat().map((event) => event.eventHash));
        return json({
          feeds: selectedFeeds,
          attestations: attestations.filter((value) => hashes.has(value.listingEventHash)),
        });
      }

      if (request.method === "GET" && path === "/api/policies") {
        return json({ policies: (await this.storage.get("policies")) || [] });
      }

      if (request.method === "PUT" && path === "/api/policies") {
        await this.requireAdmin(request);
        const input = await body(request);
        const policies = (await this.storage.get("policies")) || [];
        const policy = {
          id: String(input.id || "").trim(),
          jurisdiction: String(input.jurisdiction || "").trim(),
          version: String(input.version || "").trim(),
          effectiveAt: input.effectiveAt || new Date().toISOString(),
          sourceUrls: input.sourceUrls || [],
          restrictedCategories: input.restrictedCategories || [],
          status: input.status || "active",
        };
        if (!policy.id || !policy.jurisdiction || !policy.version) throw new Error("id, jurisdiction and version are required");
        const index = policies.findIndex((item) => item.id === policy.id && item.version === policy.version);
        if (index >= 0) policies[index] = policy;
        else policies.push(policy);
        await this.storage.put("policies", policies);
        return json({ policy });
      }

      if (request.method === "POST" && path === "/api/merchants") {
        const input = await body(request);
        const merchant = board.registerMerchant(input);
        const merchantToken = token("mch");
        const auth = (await this.storage.get("merchantAuth")) || {};
        auth[merchant.id] = await digest(merchantToken);
        await this.storage.put("merchantAuth", auth);
        await this.save(board);
        return json({ merchant, merchantToken }, 201);
      }

      const merchantMatch = path.match(/^\/api\/merchants\/([^/]+)$/);
      if (request.method === "GET" && merchantMatch) {
        const merchant = board.merchants.get(merchantMatch[1]);
        if (!merchant) return json({ error: "merchant not found" }, 404);
        return json({ merchant });
      }
      if (request.method === "PATCH" && merchantMatch) {
        await this.requireMerchant(request, merchantMatch[1]);
        const merchant = board.updateMerchant(merchantMatch[1], await body(request));
        await this.save(board);
        return json({ merchant });
      }

      const verifyMatch = path.match(/^\/api\/merchants\/([^/]+)\/verify$/);
      if (request.method === "POST" && verifyMatch) {
        await this.requireAdmin(request);
        const input = await body(request);
        const merchant = board.verifyMerchant(verifyMatch[1], input.level || "basic");
        await this.save(board);
        return json({ merchant });
      }

      const rotateMerchantTokenMatch = path.match(/^\/api\/merchants\/([^/]+)\/token$/);
      if (request.method === "POST" && rotateMerchantTokenMatch) {
        await this.requireMerchant(request, rotateMerchantTokenMatch[1]);
        const merchantToken = token("mch");
        const auth = (await this.storage.get("merchantAuth")) || {};
        auth[rotateMerchantTokenMatch[1]] = await digest(merchantToken);
        await this.storage.put("merchantAuth", auth);
        return json({ merchantId: rotateMerchantTokenMatch[1], merchantToken });
      }

      const merchantOrdersMatch = path.match(/^\/api\/merchants\/([^/]+)\/orders$/);
      if (request.method === "GET" && merchantOrdersMatch) {
        await this.requireMerchant(request, merchantOrdersMatch[1]);
        const orders = Array.from(board.orders.values()).filter((order) => order.merchantId === merchantOrdersMatch[1]);
        return json({ orders });
      }

      if (request.method === "POST" && path === "/api/listings") {
        const input = await body(request);
        await this.requireMerchant(request, input.merchantId);
        const listing = board.createListing(input.merchantId, input);
        await this.save(board);
        return json({ listing }, 201);
      }

      if (request.method === "POST" && path === "/api/images") {
        const merchantId = url.searchParams.get("merchant") || "";
        await this.requireMerchant(request, merchantId);
        if (!this.env.MARKET_IMAGES) throw new Error("image storage is not configured");
        const contentType = request.headers.get("content-type") || "";
        if (!/^image\/(png|jpeg|webp|gif)$/i.test(contentType)) throw new Error("PNG, JPEG, WebP, or GIF image required");
        const bytes = await request.arrayBuffer();
        if (!bytes.byteLength || bytes.byteLength > 5 * 1024 * 1024) throw new Error("image must be between 1 byte and 5 MB");
        const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[contentType.toLowerCase()];
        const key = `${merchantId}/${crypto.randomUUID()}.${extension}`;
        await this.env.MARKET_IMAGES.put(key, bytes, { httpMetadata: { contentType } });
        return json({ key, url: `${url.origin}/images/${key}` }, 201);
      }

      if (request.method === "GET" && path === "/api/listings") {
        const listings = board.search({
          text: url.searchParams.get("q") || "",
          currency: url.searchParams.get("currency") || undefined,
          maxPriceMinor: url.searchParams.has("max_price_minor") ? Number(url.searchParams.get("max_price_minor")) : undefined,
          shippingRegion: url.searchParams.get("ship_to") || undefined,
          sort: url.searchParams.get("sort") || "trust",
        });
        return json({ listings });
      }

      const listingMatch = path.match(/^\/api\/listings\/([^/]+)$/);
      if (request.method === "GET" && listingMatch) {
        return json({ listing: board.getPublicListing(listingMatch[1]) });
      }
      if (request.method === "PATCH" && listingMatch) {
        const input = await body(request);
        const listing = board.listings.get(listingMatch[1]);
        if (!listing) return json({ error: "listing not found" }, 404);
        await this.requireMerchant(request, listing.merchantId);
        const updated = board.updateListing(listingMatch[1], listing.merchantId, input);
        await this.save(board);
        return json({ listing: updated });
      }

      const complianceMatch = path.match(/^\/api\/listings\/([^/]+)\/compliance$/);
      if (request.method === "POST" && complianceMatch) {
        await this.requireAdmin(request);
        const listing = board.setListingCompliance(complianceMatch[1], await body(request));
        await this.save(board);
        return json({ listing });
      }

      if (request.method === "POST" && path === "/api/orders/preview") {
        return json({ preview: board.previewOrder(await body(request)) });
      }

      if (request.method === "POST" && path === "/api/orders") {
        const input = await body(request);
        const order = board.createOrder(input);
        const orderToken = token("ord");
        const auth = (await this.storage.get("orderAuth")) || {};
        auth[order.id] = await digest(orderToken);
        await this.storage.put("orderAuth", auth);
        await this.save(board);
        return json({ order, orderToken }, 201);
      }

      const orderMatch = path.match(/^\/api\/orders\/([^/]+)$/);
      if (request.method === "GET" && orderMatch) {
        await this.requireOrder(request, orderMatch[1]);
        return json({ order: board.getOrder(orderMatch[1]) });
      }

      const checkoutMatch = path.match(/^\/api\/orders\/([^/]+)\/checkout$/);
      if (request.method === "POST" && checkoutMatch) {
        await this.requireOrder(request, checkoutMatch[1]);
        const order = board.getOrder(checkoutMatch[1]);
        if (order.status !== "awaiting_payment") throw new Error("order is not awaiting payment");
        const checkoutInput = await body(request);
        const provider = checkoutInput.provider || this.env.PAYMENT_PROVIDER || "mock";
        if (provider === "stripe") {
          const accounts = (await this.storage.get("merchantPaymentAccounts")) || {};
          const result = await createStripeCheckout({
            order,
            origin: url.origin,
            secretKey: this.env.STRIPE_SECRET_KEY,
            connectedAccount: accounts[order.merchantId]?.stripeAccountId,
          });
          return json({ ...result, checkoutQrSvg: await createCheckoutQrSvg(result.checkoutUrl) });
        }
        if (provider !== "mock") throw new Error(`unsupported payment provider: ${provider}`);
        if (String(this.env.ALLOW_MOCK_PAYMENTS || "false") !== "true") throw new Error("mock payments are disabled");
        const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
        const signature = await hmac(this.paymentSigningSecret(), `${order.id}.${expiresAt}`);
        const paymentSecret = `${expiresAt}.${signature}`;
        const checkoutUrl = `${url.origin}/pay/${order.id}?secret=${encodeURIComponent(paymentSecret)}`;
        return json({
          provider: "mock",
          checkoutUrl,
          checkoutQrSvg: await createCheckoutQrSvg(checkoutUrl),
          note: "Development payment provider. Configure a production adapter before accepting real money.",
        });
      }

      const paymentAccountMatch = path.match(/^\/api\/merchants\/([^/]+)\/payment-account$/);
      if (request.method === "PUT" && paymentAccountMatch) {
        await this.requireAdmin(request);
        const input = await body(request);
        if (!/^acct_[A-Za-z0-9]+$/.test(String(input.stripeAccountId || ""))) throw new Error("valid Stripe account ID required");
        const accounts = (await this.storage.get("merchantPaymentAccounts")) || {};
        accounts[paymentAccountMatch[1]] = { stripeAccountId: input.stripeAccountId, updatedAt: new Date().toISOString() };
        await this.storage.put("merchantPaymentAccounts", accounts);
        return json({ ok: true, merchantId: paymentAccountMatch[1], provider: "stripe" });
      }

      if (request.method === "POST" && path === "/api/stripe/webhook") {
        const payload = await request.text();
        const event = await verifyStripeWebhook({
          payload,
          signatureHeader: request.headers.get("stripe-signature"),
          webhookSecret: this.env.STRIPE_WEBHOOK_SECRET,
        });
        if (event.type === "checkout.session.completed" && event.data?.object?.payment_status === "paid") {
          const orderId = event.data.object.metadata?.order_id;
          if (!orderId) throw new Error("Stripe event is missing order_id metadata");
          const existing = board.getOrder(orderId);
          if (existing.status === "awaiting_payment") {
            const verified = validateStripeCheckoutPayment(event.data.object, existing);
            board.recordVerifiedPayment({ ...verified, webhookVerified: true });
            await this.save(board);
          }
        }
        return json({ received: true });
      }

      const payMatch = path.match(/^\/api\/mock-pay\/([^/]+)$/);
      if (request.method === "POST" && payMatch) {
        const input = await body(request);
        const [rawExpiry, suppliedSignature] = String(input.secret || "").split(".");
        const expiresAt = Number(rawExpiry);
        const expectedSignature = await hmac(this.paymentSigningSecret(), `${payMatch[1]}.${rawExpiry}`);
        if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000) || suppliedSignature !== expectedSignature) {
          throw new Error("invalid or expired payment session");
        }
        const order = board.recordVerifiedPayment({
          orderId: payMatch[1],
          paymentReference: `mock_${payMatch[1]}`,
          webhookVerified: true,
        });
        await this.save(board);
        return json({ order });
      }

      const statusMatch = path.match(/^\/api\/orders\/([^/]+)\/status$/);
      if (request.method === "POST" && statusMatch) {
        const order = board.getOrder(statusMatch[1]);
        const input = await body(request);
        if (["completed", "disputed"].includes(input.status)) await this.requireOrder(request, statusMatch[1]);
        else await this.requireMerchant(request, order.merchantId);
        const updated = board.updateOrderStatus({ orderId: statusMatch[1], ...input });
        await this.save(board);
        return json({ order: updated });
      }

      const commentsMatch = path.match(/^\/api\/listings\/([^/]+)\/comments$/);
      if (request.method === "POST" && commentsMatch) {
        const input = await body(request);
        if (input.orderId) await this.requireOrder(request, input.orderId);
        const comment = board.addComment({ listingId: commentsMatch[1], ...input });
        await this.save(board);
        return json({ comment }, 201);
      }

      return json({ error: "not found" }, 404);
    } catch (error) {
      const message = error?.message || String(error);
      const status = /authorization|required payment webhook|invalid payment session/.test(message) ? 401 : /not found/.test(message) ? 404 : 400;
      return json({ error: message }, status);
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const imageMatch = url.pathname.match(/^\/images\/(.+)$/);
    if (request.method === "GET" && imageMatch && env.MARKET_IMAGES) {
      const object = await env.MARKET_IMAGES.get(imageMatch[1]);
      if (!object) return new Response("not found", { status: 404 });
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("cache-control", "public, max-age=86400");
      headers.set("x-content-type-options", "nosniff");
      return new Response(object.body, { headers });
    }
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(BOARD_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const payPage = url.pathname.match(/^\/pay\/([^/]+)$/);
    if (request.method === "GET" && payPage) {
      const secret = url.searchParams.get("secret") || "";
      return new Response(`<!doctype html><meta charset="utf-8"><title>Mock payment</title><style>body{font:16px system-ui;max-width:620px;margin:80px auto;padding:20px}button{padding:12px 18px}</style><h1>Development payment</h1><p>This page never moves real money. It only tests the order flow.</p><button id="pay">Confirm simulated payment</button><pre id="out"></pre><script>pay.onclick=async()=>{pay.disabled=true;const r=await fetch('/api/mock-pay/${payPage[1]}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret:${JSON.stringify(secret)}})});out.textContent=JSON.stringify(await r.json(),null,2)}</script>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const id = env.MARKET_ROOM.idFromName("global");
    return env.MARKET_ROOM.get(id).fetch(request);
  },
};
