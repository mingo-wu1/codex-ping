import { rankTradeStats } from "./ranking.js";

const nowIso = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID()}`;

export class MarketBoard {
  constructor(snapshot = {}) {
    this.merchants = new Map(snapshot.merchants || []);
    this.listings = new Map(snapshot.listings || []);
    this.orders = new Map(snapshot.orders || []);
    this.tradeStats = new Map(snapshot.tradeStats || []);
    this.comments = new Map(snapshot.comments || []);
  }

  snapshot() {
    return structuredClone({
      merchants: Array.from(this.merchants.entries()),
      listings: Array.from(this.listings.entries()),
      orders: Array.from(this.orders.entries()),
      tradeStats: Array.from(this.tradeStats.entries()),
      comments: Array.from(this.comments.entries()),
    });
  }

  registerMerchant(input) {
    if (!input.displayName?.trim()) throw new Error("displayName is required");
    if (!input.operatingRegions?.length) throw new Error("operatingRegions is required");
    const merchant = {
      id: makeId("mer"),
      displayName: input.displayName.trim(),
      entityType: input.entityType || "individual",
      operatingRegions: [...new Set(input.operatingRegions)],
      verificationLevel: "unverified",
      policyAcceptances: input.policyAcceptances || [],
      status: "pending_verification",
      joinedAt: nowIso(),
    };
    this.merchants.set(merchant.id, merchant);
    return structuredClone(merchant);
  }

  verifyMerchant(merchantId, level = "basic") {
    const merchant = this.#merchant(merchantId);
    merchant.verificationLevel = level;
    merchant.status = "active";
    return structuredClone(merchant);
  }

  updateMerchant(merchantId, input) {
    const merchant = this.#merchant(merchantId);
    if (input.displayName != null) {
      if (!String(input.displayName).trim()) throw new Error("displayName cannot be empty");
      merchant.displayName = String(input.displayName).trim();
    }
    if (input.operatingRegions != null) {
      if (!Array.isArray(input.operatingRegions) || !input.operatingRegions.length) throw new Error("operatingRegions cannot be empty");
      merchant.operatingRegions = [...new Set(input.operatingRegions)];
    }
    if (input.policyAcceptances != null) merchant.policyAcceptances = input.policyAcceptances;
    return structuredClone(merchant);
  }

  createListing(merchantId, input) {
    const merchant = this.#merchant(merchantId);
    if (merchant.status !== "active") throw new Error("merchant is not active");
    if (!input.title?.trim()) throw new Error("title is required");
    if (!Number.isFinite(input.priceMinor) || input.priceMinor < 0) {
      throw new Error("priceMinor must be a non-negative integer");
    }
    const listing = {
      id: makeId("lst"),
      merchantId,
      title: input.title.trim(),
      summary: String(input.summary || "").trim(),
      category: input.category || "uncategorized",
      attributes: input.attributes || {},
      priceMinor: Math.round(input.priceMinor),
      currency: String(input.currency || "USD").toUpperCase(),
      shippingRegions: input.shippingRegions || [],
      images: input.images || [],
      compliance: {
        status: "review",
        policyId: input.policyId || null,
        policyVersion: input.policyVersion || null,
        reasonCode: null,
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.listings.set(listing.id, listing);
    this.tradeStats.set(listing.id, {
      paidOrders: 0,
      completedOrders: 0,
      repeatBuyers: 0,
      fulfilledOnTime: 0,
      refunds: 0,
      disputes: 0,
    });
    return structuredClone(listing);
  }

  setListingCompliance(listingId, decision) {
    const listing = this.#listing(listingId);
    if (!['active', 'restricted', 'blocked'].includes(decision.status)) {
      throw new Error("invalid compliance status");
    }
    listing.compliance = {
      status: decision.status,
      policyId: decision.policyId,
      policyVersion: decision.policyVersion,
      reasonCode: decision.reasonCode || null,
    };
    listing.updatedAt = nowIso();
    return structuredClone(listing);
  }

  updateListing(listingId, merchantId, input) {
    const listing = this.#listing(listingId);
    if (listing.merchantId !== merchantId) throw new Error("listing does not belong to merchant");
    const editable = ["title", "summary", "category", "attributes", "priceMinor", "currency", "shippingRegions", "images"];
    let changed = false;
    for (const field of editable) {
      if (input[field] == null) continue;
      listing[field] = field === "currency" ? String(input[field]).toUpperCase() : structuredClone(input[field]);
      changed = true;
    }
    if (input.status === "archived") {
      listing.compliance.status = "archived";
      changed = true;
    } else if (changed && listing.compliance.status === "active") {
      listing.compliance.status = "review";
      listing.compliance.reasonCode = "MERCHANT_EDIT";
    }
    listing.updatedAt = nowIso();
    return structuredClone(listing);
  }

  search(query = {}) {
    const text = String(query.text || "").trim().toLocaleLowerCase();
    return Array.from(this.listings.values())
      .filter((listing) => listing.compliance.status === "active")
      .filter((listing) => !text || `${listing.title} ${listing.summary}`.toLocaleLowerCase().includes(text))
      .filter((listing) => query.currency == null || listing.currency === query.currency.toUpperCase())
      .filter((listing) => query.maxPriceMinor == null || listing.priceMinor <= query.maxPriceMinor)
      .filter((listing) => !query.shippingRegion || listing.shippingRegions.includes(query.shippingRegion))
      .map((listing) => ({
        ...structuredClone(listing),
        merchant: structuredClone(this.#merchant(listing.merchantId)),
        ranking: rankTradeStats(this.tradeStats.get(listing.id)),
      }))
      .sort((a, b) => {
        if (query.sort === "price") return a.priceMinor - b.priceMinor;
        return b.ranking.score - a.ranking.score;
      });
  }

  previewOrder({ listingId, quantity = 1 }) {
    const listing = this.#orderableListing(listingId);
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error("quantity must be a positive integer");
    return {
      listingId,
      merchantId: listing.merchantId,
      title: listing.title,
      quantity,
      unitPriceMinor: listing.priceMinor,
      totalMinor: listing.priceMinor * quantity,
      currency: listing.currency,
      compliance: structuredClone(listing.compliance),
    };
  }

  createOrder({ listingId, quantity = 1, buyerId, buyerConfirmed = false }) {
    if (!buyerConfirmed) throw new Error("buyer confirmation is required");
    if (!buyerId?.trim()) throw new Error("buyerId is required");
    const preview = this.previewOrder({ listingId, quantity });
    const order = {
      id: makeId("ord"),
      buyerId: buyerId.trim(),
      ...preview,
      status: "awaiting_payment",
      paymentReference: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.orders.set(order.id, order);
    return structuredClone(order);
  }

  recordVerifiedPayment({ orderId, paymentReference, webhookVerified }) {
    if (webhookVerified !== true) throw new Error("verified payment webhook is required");
    const order = this.#order(orderId);
    if (order.status !== "awaiting_payment") throw new Error("order is not awaiting payment");
    order.status = "paid";
    order.paymentReference = paymentReference;
    order.updatedAt = nowIso();
    const stats = this.tradeStats.get(order.listingId);
    stats.paidOrders += 1;
    return structuredClone(order);
  }

  updateOrderStatus({ orderId, status, fulfilledOnTime = false }) {
    const order = this.#order(orderId);
    const transitions = {
      paid: ["accepted", "refunded", "disputed"],
      accepted: ["fulfilled", "refunded", "disputed"],
      fulfilled: ["completed", "refunded", "disputed"],
      completed: ["refunded", "disputed"],
    };
    if (!(transitions[order.status] || []).includes(status)) {
      throw new Error(`invalid order transition: ${order.status} -> ${status}`);
    }
    order.status = status;
    order.updatedAt = nowIso();
    const stats = this.tradeStats.get(order.listingId);
    if (status === "completed") {
      stats.completedOrders += 1;
      if (fulfilledOnTime) stats.fulfilledOnTime += 1;
      const previous = Array.from(this.orders.values()).filter(
        (candidate) =>
          candidate.id !== order.id &&
          candidate.buyerId === order.buyerId &&
          candidate.merchantId === order.merchantId &&
          candidate.status === "completed",
      );
      if (previous.length === 1) stats.repeatBuyers += 1;
    }
    if (status === "refunded") stats.refunds += 1;
    if (status === "disputed") stats.disputes += 1;
    return structuredClone(order);
  }

  addComment({ listingId, orderId = null, authorId, body }) {
    this.#listing(listingId);
    if (!authorId?.trim() || !body?.trim()) throw new Error("authorId and body are required");
    let verifiedPurchase = false;
    if (orderId) {
      const order = this.#order(orderId);
      if (order.listingId !== listingId || order.buyerId !== authorId) {
        throw new Error("order does not belong to this buyer and listing");
      }
      verifiedPurchase = ["paid", "accepted", "fulfilled", "completed", "refunded", "disputed"].includes(order.status);
    }
    const comment = {
      id: makeId("cmt"),
      listingId,
      orderId,
      authorId: authorId.trim(),
      body: body.trim(),
      verifiedPurchase,
      createdAt: nowIso(),
    };
    const comments = this.comments.get(listingId) || [];
    comments.push(comment);
    this.comments.set(listingId, comments);
    return structuredClone(comment);
  }

  getPublicListing(listingId) {
    const listing = this.#listing(listingId);
    return {
      ...structuredClone(listing),
      merchant: structuredClone(this.#merchant(listing.merchantId)),
      ranking: rankTradeStats(this.tradeStats.get(listing.id)),
      comments: structuredClone(this.comments.get(listingId) || []),
    };
  }

  getOrder(orderId) {
    return structuredClone(this.#order(orderId));
  }

  #merchant(id) {
    const value = this.merchants.get(id);
    if (!value) throw new Error("merchant not found");
    return value;
  }

  #listing(id) {
    const value = this.listings.get(id);
    if (!value) throw new Error("listing not found");
    return value;
  }

  #order(id) {
    const value = this.orders.get(id);
    if (!value) throw new Error("order not found");
    return value;
  }

  #orderableListing(id) {
    const listing = this.#listing(id);
    if (listing.compliance.status !== "active") throw new Error("listing is not orderable");
    return listing;
  }
}
