#!/usr/bin/env python3
"""Administrative CLI. The token is read only from MARKET_ADMIN_TOKEN."""

import argparse
import json
import os
import urllib.error
import urllib.request


def call(server, token, method, path, data):
    request = urllib.request.Request(
        server.rstrip("/") + path,
        data=json.dumps(data).encode("utf-8"),
        headers={"content-type": "application/json", "x-admin-token": token},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise SystemExit(exc.read().decode("utf-8")) from exc


def main():
    parser = argparse.ArgumentParser(description="Codex Market Board administrator")
    parser.add_argument("--server", default=os.environ.get("CODEX_MARKET_SERVER", "http://127.0.0.1:8791"))
    commands = parser.add_subparsers(dest="command", required=True)

    verify = commands.add_parser("verify-merchant")
    verify.add_argument("merchant_id")
    verify.add_argument("--level", default="basic")

    decide = commands.add_parser("decide-listing")
    decide.add_argument("listing_id")
    decide.add_argument("status", choices=["active", "restricted", "blocked"])
    decide.add_argument("--policy-id", required=True)
    decide.add_argument("--policy-version", required=True)
    decide.add_argument("--reason-code")

    policy = commands.add_parser("put-policy")
    policy.add_argument("policy_id")
    policy.add_argument("jurisdiction")
    policy.add_argument("version")
    policy.add_argument("--source", action="append", default=[])
    policy.add_argument("--restrict", action="append", default=[])

    account = commands.add_parser("set-stripe-account")
    account.add_argument("merchant_id")
    account.add_argument("stripe_account_id")

    args = parser.parse_args()
    token = os.environ.get("MARKET_ADMIN_TOKEN")
    if not token:
        raise SystemExit("MARKET_ADMIN_TOKEN is required")

    if args.command == "verify-merchant":
        result = call(args.server, token, "POST", f"/api/merchants/{args.merchant_id}/verify", {"level": args.level})
    elif args.command == "decide-listing":
        result = call(args.server, token, "POST", f"/api/listings/{args.listing_id}/compliance", {
            "status": args.status,
            "policyId": args.policy_id,
            "policyVersion": args.policy_version,
            "reasonCode": args.reason_code,
        })
    elif args.command == "put-policy":
        result = call(args.server, token, "PUT", "/api/policies", {
            "id": args.policy_id,
            "jurisdiction": args.jurisdiction,
            "version": args.version,
            "sourceUrls": args.source,
            "restrictedCategories": args.restrict,
        })
    else:
        result = call(args.server, token, "PUT", f"/api/merchants/{args.merchant_id}/payment-account", {
            "stripeAccountId": args.stripe_account_id,
        })
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
