# API summary

All request and response bodies are JSON except image uploads. Money uses integer minor units (`19900 CNY` means `¥199.00`).

## Public

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/policies` | Public rule registry |
| GET | `/api/listings` | Search active listings |
| GET | `/api/listings/:id` | Listing, merchant, compliance, ranking and comments |
| GET | `/api/merchants/:id` | Public merchant profile |
| POST | `/api/orders/preview` | Non-binding order preview |
| POST | `/api/merchants` | Register a merchant; returns its token once |

Search parameters: `q`, `currency`, `max_price_minor`, `ship_to`, and `sort=trust|price`.

## Merchant bearer token

| Method | Path | Purpose |
|---|---|---|
| PATCH | `/api/merchants/:id` | Update the public merchant profile |
| POST | `/api/merchants/:id/token` | Rotate the merchant token |
| GET | `/api/merchants/:id/orders` | List merchant orders |
| POST | `/api/images?merchant=:id` | Upload PNG/JPEG/WebP/GIF, maximum 5 MB |
| POST | `/api/listings` | Submit a listing for review |
| PATCH | `/api/listings/:id` | Update/archive a listing; active edits return to review |
| POST | `/api/orders/:id/status` | Accept, fulfill, or refund an order |

## Buyer order bearer token

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/orders/:id` | Read an order |
| POST | `/api/orders/:id/checkout` | Create a provider checkout session |
| POST | `/api/orders/:id/status` | Confirm completion or open a dispute |
| POST | `/api/listings/:id/comments` | Create an order-linked verified comment |

`POST /api/orders` requires `buyerConfirmed: true` and returns the order token once.

## Administrator

Send `X-Admin-Token`:

| Method | Path | Purpose |
|---|---|---|
| PUT | `/api/policies` | Publish/update a rule version |
| POST | `/api/merchants/:id/verify` | Verify a merchant |
| POST | `/api/listings/:id/compliance` | Activate, restrict, or block a listing |
| PUT | `/api/merchants/:id/payment-account` | Set private Stripe Connect account |

Use [marketadmin.py](../marketadmin.py) rather than placing the administrator token in command history.

## Payment-provider callbacks

- `POST /api/stripe/webhook` verifies Stripe's signature and payment status before recording payment.
- `POST /api/mock-pay/:id` exists only for local development and is disabled by default.
