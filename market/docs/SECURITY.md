# Security and trust model

## Secrets

- Merchant tokens and order tokens are returned once and stored only as SHA-256 digests on the board.
- Administrator, payment-signing, Stripe API, and Stripe webhook secrets are Cloudflare Worker secrets.
- Stripe account IDs are private administrative records and never appear in the public merchant response.
- The service never asks for or stores card numbers, CVV values, identity documents, or bank credentials.

## Payment truth

- Client requests cannot directly mark an order paid.
- Stripe orders become paid only after a timestamp-bounded, HMAC-verified webhook.
- Mock checkout is disabled by default and must never be enabled on a public production deployment.
- Stripe Checkout creation uses the order ID as its idempotency key.
- A merchant can accept and fulfill an order, but only the buyer order token can confirm completion or open a dispute.

## Public and private data

Public: merchant display profile, listing summary, rule/version, compliance status, aggregated trade statistics, and comments.  
Private: authentication tokens, payment account mapping, order access tokens, internal evidence, personal address, chat content, and payment credentials.

The current MVP intentionally does not collect shipping addresses. A production logistics integration must store them in a separate access-controlled service with retention and deletion rules.

## Moderation

- Merchant edits return active listings to review.
- Blocked listings cannot create new orders.
- Compliance decisions carry a policy ID, version, reason code, and timestamped listing update.
- Merchant declarations do not prove legality. Launching in a jurisdiction requires professional review of marketplace, consumer, privacy, tax, restricted-goods, and payment obligations.

## Before public production

1. Set `ALLOW_MOCK_PAYMENTS=false`.
2. Set `ALLOW_DEMO_AUTO_APPROVAL=false` (or leave it unset). It exists only for the local two-computer demo and labels approvals `demo-only`.
2. Configure Cloudflare rate limiting/WAF for write endpoints.
3. Restrict CORS to approved origins if third-party clients are not intended.
4. Configure Stripe secrets and webhook delivery retries.
5. Add backups, retention limits, abuse reporting, administrator audit logs, and merchant appeals.
6. Run a security review of authentication, authorization, webhook verification, SSRF, content moderation, and uploaded-media handling.
