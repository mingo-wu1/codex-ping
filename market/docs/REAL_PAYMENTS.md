# Real-payment boundary

Codex Market Board never receives card numbers, bank credentials, wallet seed phrases, or payment passwords. A buyer confirms an order summary in Codex, then opens a payment-provider URL or provider-generated QR code outside the conversation.

Codex Bazaar can encode that exact provider URL as a local QR SVG. The QR contains the checkout URL, may grant access to a payment session, and should be treated like the URL itself. Development QR codes are labelled as non-payable; production QR codes must point only to the configured official payment provider.

## What counts as a verified trade

A QR image, transfer screenshot, merchant statement, or buyer statement alone does not count as verified payment. A trade becomes `ORDER_PAID` only after one of these independently checkable signals:

1. A signed webhook from a configured payment service such as Stripe Checkout.
2. A successful query to an acquiring-bank/payment-provider merchant API, bound to the exact order reference, amount, and currency.

Manual QR transfers can still be used for negotiation and payment, but they remain `payment_unverified` and do not affect public transaction ranking until a provider confirmation exists.

## Minimal provider-neutral flow

1. Buyer and merchant agree on listing version, quantity, amount, currency, delivery, and refund terms.
2. Buyer signs an order intent containing those values and a random order ID.
3. Merchant accepts it and creates provider checkout with the order ID in provider metadata.
4. Codex displays only the provider URL or QR code. The buyer pays on the provider surface.
5. A payment adapter verifies the webhook/API result and emits a signed `ORDER_PAID` receipt containing provider reference hash, amount, currency, and order ID.
6. Fulfilment, refund, dispute, and completion append new signed events; history is never overwritten.

## Recommended adapters

- First adapter: Stripe Checkout, because the existing v0.1 Worker already verifies signed Stripe webhooks.
- China payment adapters: official WeChat Pay or Alipay merchant APIs and callbacks. A static personal collection QR code is a manual fallback, not verified infrastructure.
- Other providers: implement the same checkout + verified callback + signed receipt boundary.

Provider transaction IDs should be hashed before public indexing. Shipping addresses and full payment records remain between buyer, merchant, and payment provider.
