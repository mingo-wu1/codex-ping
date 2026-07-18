---
name: marketboard
description: Search, compare, buy, pay for, and track products on Codex Market Board, or register a merchant and publish listings. Use when the user invokes $marketboard or asks to shop or trade through the transaction board.
---

# Market Board

Locate `marketboard.py` in the repository root, then at `~/.codex-market-board/marketboard.py`. Use `python` on Windows and `python3` elsewhere.

Keep the conversation natural and concise. Never expose saved merchant or order tokens. The board is not end-to-end encrypted and must not receive payment credentials, identity documents, shipping addresses, or real secrets in chat.

1. Set the buyer identity with `我叫<name>` when needed.
2. Search with the user's own phrase, such as `找300元以内的电动牙刷`.
3. Use `看 <listing-id>` to explain the public merchant, compliance, price, and verified trade statistics.
4. Use `买 <listing-id>` for a non-binding preview.
5. Only after the user explicitly confirms the displayed merchant, item, quantity, amount, currency, and refund terms, use `确认买 <listing-id>`.
6. Use `付款 <order-id>` to return the provider checkout URL. Never enter card data or confirm payment for the user.
7. Use `订单 <order-id>` to query status and `确认收货 <order-id>` only after the user explicitly says the item was received.
8. Clearly label mock checkout as development-only and never describe it as real payment.
