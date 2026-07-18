# Codex Bazaar Market module

This directory contains the verifiable commerce module of [Codex Bazaar](../README.md). Install the project only from the repository root; this module intentionally has no separate installer or skill.

## Included

- Cloudflare Worker, Durable Object, and R2-backed reference blackboard.
- Merchant registration, listings, compliance status, search, orders, comments, and explainable transaction ranking.
- Merchant-hosted signed listing feeds, independent attestations, on-demand details, and image-hash verification.
- Stripe Checkout creation and signed webhook validation bound to order ID, amount, and currency.
- Development-only checkout QR generation and a complete no-real-money commerce test.

## Verify

Node.js 22 or newer is required for Wrangler:

```bash
npm install
npm test
npm run test:cli
npm run test:worker-cli
npm run test:commerce
```

`test:commerce` uses the generated toothbrush photo to execute this full flow through the real local Worker runtime:

```text
merchant registration → product image upload → listing approval → buyer search
→ exact order preview → explicit order confirmation → checkout QR encode/decode
→ development payment confirmation → merchant acceptance → fulfilment
→ buyer completion → verified-purchase comment → completed-order ranking
```

The QR in this test is deliberately non-payable and cannot move real money. Production payment requirements are documented in [docs/REAL_PAYMENTS.md](docs/REAL_PAYMENTS.md).

## Documentation

- [Protocol and architecture](docs/DECENTRALIZED_PROTOCOL.md)
- [Product requirements](docs/PRD.md)
- [API](docs/API.md)
- [Security](docs/SECURITY.md)
- [Real-payment boundary](docs/REAL_PAYMENTS.md)
