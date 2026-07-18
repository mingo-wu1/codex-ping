#!/usr/bin/env python3
"""Small natural-language client for Codex Market Board."""

from __future__ import annotations

import json
import os
import re
import sys
import base64
import hashlib
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


CONFIG_DIR = Path(os.environ.get("CODEX_MARKET_HOME", Path.home() / ".codex-market-board"))
CONFIG_FILE = CONFIG_DIR / "config.json"
DEFAULT_SERVER = os.environ.get("CODEX_MARKET_SERVER", "http://127.0.0.1:8791")


def load_config():
    if CONFIG_FILE.exists():
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    return {"server": DEFAULT_SERVER, "orders": {}}


def save_config(config):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


def request(config, method, path, data=None, token=None):
    headers = {"accept": "application/json", "user-agent": "Codex-Bazaar/0.1"}
    payload = None
    if data is not None:
        headers["content-type"] = "application/json"
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = urllib.request.Request(config["server"].rstrip("/") + path, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            message = json.loads(exc.read().decode("utf-8")).get("error", str(exc))
        except Exception:
            message = str(exc)
        raise RuntimeError(message) from exc


def upload(config, path, content_type, content, token_value):
    headers = {"content-type": content_type, "authorization": f"Bearer {token_value}", "accept": "application/json", "user-agent": "Codex-Bazaar/0.1"}
    req = urllib.request.Request(config["server"].rstrip("/") + path, data=content, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            message = json.loads(exc.read().decode("utf-8")).get("error", str(exc))
        except Exception:
            message = str(exc)
        raise RuntimeError(message) from exc


def image_file(path_text):
    file_path = Path(path_text.strip().strip('"')).expanduser()
    if not file_path.is_file():
        raise RuntimeError("图片文件不存在")
    content_types = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}
    content_type = content_types.get(file_path.suffix.lower())
    if not content_type:
        raise RuntimeError("只支持 PNG、JPEG、WebP 或 GIF")
    content = file_path.read_bytes()
    if len(content) > 2 * 1024 * 1024:
        raise RuntimeError("Base64 演示图片不能超过 2 MB")
    return file_path, content_type, content


def download_listing_image(url, listing_id):
    req = urllib.request.Request(url, headers={"user-agent": "Codex-Bazaar/0.1"})
    with urllib.request.urlopen(req, timeout=30) as response:
        content = response.read()
        content_type = response.headers.get_content_type()
        expected_hash = response.headers.get("x-content-sha256")
    actual_hash = hashlib.sha256(content).hexdigest()
    if expected_hash and expected_hash != actual_hash:
        raise RuntimeError("商品图片校验失败")
    extension = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}.get(content_type, ".img")
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    destination = CONFIG_DIR / f"{listing_id}{extension}"
    destination.write_bytes(content)
    return destination, actual_hash


def money(minor, currency):
    return f"{minor / 100:.2f} {currency}"


def listing_reference(config, value="这个"):
    if value == "这个":
        listing_id = config.get("lastListingId")
    else:
        numbered = re.fullmatch(r"第(\d+)个", value)
        if numbered:
            index = int(numbered.group(1)) - 1
            results = config.get("lastSearchResults", [])
            listing_id = results[index] if 0 <= index < len(results) else None
        else:
            listing_id = value
    if not listing_id:
        raise RuntimeError("请先搜索商品")
    return listing_id


def create_checkout(config, order_id):
    order_token = config.get("orders", {}).get(order_id)
    if not order_token:
        raise RuntimeError("本机没有最近订单的访问凭证")
    result = request(config, "POST", f"/api/orders/{urllib.parse.quote(order_id)}/checkout", {}, order_token)
    qr_path = None
    if result.get("checkoutQrSvg"):
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        qr_path = CONFIG_DIR / f"{order_id}-checkout.svg"
        qr_path.write_text(result["checkoutQrSvg"], encoding="utf-8")
    config.setdefault("paymentSessions", {})[order_id] = {"provider": result.get("provider"), "checkoutUrl": result.get("checkoutUrl")}
    config["lastOrderId"] = order_id
    save_config(config)
    provider_note = "开发测试二维码，不会扣真实资金。" if result.get("provider") == "mock" else f"支付提供商：{result.get('provider', 'external')}。"
    return f"付款二维码：{qr_path}\n{provider_note}" if qr_path else f"付款链接：{result['checkoutUrl']}\n{provider_note}"


def search(config, text):
    budget = re.search(r"(\d+(?:\.\d+)?)\s*元(?:以内|以下)?", text)
    query = re.sub(r"(?:找|搜索|想买|我要买|购买)", " ", text)
    if budget:
        query = query.replace(budget.group(0), " ")
    query = " ".join(query.replace("的", " ").split())
    params = {"q": query, "sort": "trust"}
    if budget:
        params.update({"max_price_minor": str(round(float(budget.group(1)) * 100)), "currency": "CNY"})
    result = request(config, "GET", "/api/listings?" + urllib.parse.urlencode(params))
    listings = result.get("listings", [])
    if not listings:
        return "没有找到符合条件的公开商品。"
    listings.sort(key=lambda item: bool(item.get("images")), reverse=True)
    config["lastSearchResults"] = [item["id"] for item in listings[:10]]
    config["lastListingId"] = listings[0]["id"]
    save_config(config)
    lines = []
    for index, item in enumerate(listings[:10], 1):
        stats = item["ranking"]["explanation"]
        image_note = ""
        if item.get("images") and index <= 3:
            image_path, _ = download_listing_image(item["images"][0], item["id"])
            image_note = f"｜图片：{image_path}"
        lines.append(
            f"{index}. {item['title']}｜{money(item['priceMinor'], item['currency'])}｜"
            f"{item['merchant']['displayName']}｜真实付款样本 {stats['sampleSize']}{image_note}"
        )
    lines.append("已记住搜索结果。可以说：买这个，或买第2个。")
    return "\n".join(lines)


def main(argv):
    config = load_config()
    text = " ".join(argv).strip()
    if not text:
        print("可以说：找300元以内的电动牙刷、看 <商品ID>、确认买 <商品ID>、付款 <订单ID>、订单 <订单ID>")
        return 0

    server = re.fullmatch(r"(?:服务器|server)\s+(.+)", text, re.IGNORECASE)
    if server:
        config["server"] = server.group(1).rstrip("/")
        save_config(config)
        print(f"交易黑板服务器已设为 {config['server']}")
        return 0

    identity = re.fullmatch(r"我叫\s*(.+)", text)
    if identity:
        config["buyerId"] = identity.group(1).strip()
        save_config(config)
        print(f"你现在叫 {config['buyerId']}")
        return 0

    merchant = re.fullmatch(r"商家入驻\s+(.+)", text)
    if merchant:
        result = request(config, "POST", "/api/merchants", {
            "displayName": merchant.group(1).strip(),
            "entityType": "individual",
            "operatingRegions": ["CN"],
            "policyAcceptances": [],
        })
        config["merchant"] = {"id": result["merchant"]["id"], "token": result["merchantToken"]}
        save_config(config)
        merchant_status = result["merchant"]["status"]
        print(f"商家已登记：{result['merchant']['displayName']}（{merchant_status}）")
        return 0

    publish_image = re.fullmatch(r"发布图\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(.+)", text)
    if publish_image:
        merchant_config = config.get("merchant")
        if not merchant_config:
            raise RuntimeError("请先完成商家入驻")
        file_path, content_type, content = image_file(publish_image.group(3))
        encoded = base64.b64encode(content).decode("ascii")
        image = request(config, "POST", "/api/base64-images", {
            "merchantId": merchant_config["id"],
            "contentType": content_type,
            "base64": encoded,
            "sha256": hashlib.sha256(content).hexdigest(),
        }, merchant_config["token"])
        result = request(config, "POST", "/api/listings", {
            "merchantId": merchant_config["id"],
            "title": publish_image.group(1).strip(),
            "summary": publish_image.group(1).strip(),
            "category": "general-goods",
            "priceMinor": round(float(publish_image.group(2)) * 100),
            "currency": "CNY",
            "shippingRegions": ["CN"],
            "images": [image["url"]],
        }, merchant_config["token"])
        item = result["listing"]
        print(f"商品和图片已发布：{item['title']}｜{money(item['priceMinor'], item['currency'])}｜{item['id']}｜图片 {image['bytes']} 字节｜SHA-256 {image['sha256']}")
        return 0

    upload_image = re.fullmatch(r"上传图\s+(.+)", text)
    if upload_image:
        merchant_config = config.get("merchant")
        if not merchant_config:
            raise RuntimeError("请先完成商家入驻")
        file_path = Path(upload_image.group(1).strip().strip('"')).expanduser()
        if not file_path.is_file():
            raise RuntimeError("图片文件不存在")
        content_types = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}
        content_type = content_types.get(file_path.suffix.lower())
        if not content_type:
            raise RuntimeError("只支持 PNG、JPEG、WebP 或 GIF")
        result = upload(
            config,
            "/api/images?" + urllib.parse.urlencode({"merchant": merchant_config["id"]}),
            content_type,
            file_path.read_bytes(),
            merchant_config["token"],
        )
        config.setdefault("pendingImages", []).append(result["url"])
        save_config(config)
        print(f"图片已上传，将用于下一件发布的商品：{result['url']}")
        return 0

    publish = re.fullmatch(r"发布\s+(.+?)\s+(\d+(?:\.\d+)?)(?:\s+([A-Za-z]{3}))?", text)
    if publish:
        merchant_config = config.get("merchant")
        if not merchant_config:
            raise RuntimeError("请先完成商家入驻")
        currency = (publish.group(3) or "CNY").upper()
        result = request(config, "POST", "/api/listings", {
            "merchantId": merchant_config["id"],
            "title": publish.group(1).strip(),
            "summary": publish.group(1).strip(),
            "category": "general-goods",
            "priceMinor": round(float(publish.group(2)) * 100),
            "currency": currency,
            "shippingRegions": ["CN"],
            "images": config.get("pendingImages", []),
        }, merchant_config["token"])
        config["pendingImages"] = []
        save_config(config)
        item = result["listing"]
        print(f"商品已发布：{item['title']}｜{money(item['priceMinor'], item['currency'])}｜{item['id']}｜{item['compliance']['status']}")
        return 0

    if text in {"商家订单", "订单"} and config.get("merchant"):
        merchant_config = config.get("merchant")
        if not merchant_config:
            raise RuntimeError("请先完成商家入驻")
        orders = request(config, "GET", f"/api/merchants/{merchant_config['id']}/orders", token=merchant_config["token"])["orders"]
        if not orders:
            print("暂无订单。")
        else:
            config["lastMerchantOrderId"] = orders[-1]["id"]
            save_config(config)
            print("\n".join(f"{item['title']} × {item['quantity']}｜{item['status']} ({item.get('paymentVerification') or '未付款'})｜{money(item['totalMinor'], item['currency'])}" for item in orders[-5:]))
            print("已记住最新订单。可以直接说：接单。")
        return 0

    merchant_action = re.fullmatch(r"(接单|已发货|发货|退款)(?:\s+([^\s]+))?", text)
    if merchant_action:
        merchant_config = config.get("merchant")
        if not merchant_config:
            raise RuntimeError("请先完成商家入驻")
        order_id = merchant_action.group(2) or config.get("lastMerchantOrderId")
        if not order_id:
            raise RuntimeError("请先说：订单")
        status = {"接单": "accepted", "已发货": "fulfilled", "发货": "fulfilled", "退款": "refunded"}[merchant_action.group(1)]
        result = request(config, "POST", f"/api/orders/{urllib.parse.quote(order_id)}/status", {"status": status}, merchant_config["token"])["order"]
        config["lastMerchantOrderId"] = order_id
        save_config(config)
        print(f"订单状态已更新：{result['status']}")
        return 0

    listing = re.fullmatch(r"看(?:\s*([^\s]+))?", text)
    if listing:
        listing_id = listing_reference(config, listing.group(1) or "这个")
        item = request(config, "GET", f"/api/listings/{urllib.parse.quote(listing_id)}")["listing"]
        config["lastListingId"] = listing_id
        save_config(config)
        stats = item["ranking"]["explanation"]
        image_note = ""
        if item.get("images"):
            image_path, image_hash = download_listing_image(item["images"][0], item["id"])
            image_note = f"\n图片已保存：{image_path}\n图片 SHA-256：{image_hash}"
        print(f"{item['title']}\n{item['summary']}\n价格：{money(item['priceMinor'], item['currency'])}\n商家：{item['merchant']['displayName']}\n合规：{item['compliance']['status']} / {item['compliance']['policyId']} v{item['compliance']['policyVersion']}\n真实付款样本：{stats['sampleSize']}，退款率：{stats['refundRate']:.1%}，争议率：{stats['disputeRate']:.1%}{image_note}")
        return 0

    buy = re.fullmatch(r"(?:确认买(?:\s*([^\s]+))?|确认)(?:\s+(\d+))?", text)
    if buy:
        if not config.get("buyerId"):
            raise RuntimeError("请先说：我叫<名字>")
        result = request(config, "POST", "/api/orders", {
            "listingId": listing_reference(config, buy.group(1) or "这个"),
            "quantity": int(buy.group(2) or 1),
            "buyerId": config["buyerId"],
            "buyerConfirmed": True,
        })
        order = result["order"]
        config.setdefault("orders", {})[order["id"]] = result["orderToken"]
        config["lastOrderId"] = order["id"]
        save_config(config)
        checkout_note = create_checkout(config, order["id"])
        print(f"订单已创建\n应付：{money(order['totalMinor'], order['currency'])}\n{checkout_note}\n模拟完成后说：我已付款")
        return 0

    preview = re.fullmatch(r"(?:预览|买)(?:\s*([^\s]+))?(?:\s+(\d+))?", text)
    if preview:
        listing_id = listing_reference(config, preview.group(1) or "这个")
        config["lastListingId"] = listing_id
        save_config(config)
        result = request(config, "POST", "/api/orders/preview", {"listingId": listing_id, "quantity": int(preview.group(2) or 1)})["preview"]
        print(f"{result['title']} × {result['quantity']}\n合计：{money(result['totalMinor'], result['currency'])}\n确认无误后说：确认")
        return 0

    pay = re.fullmatch(r"付款(?:\s+([^\s]+))?", text)
    if pay:
        order_id = pay.group(1) or config.get("lastOrderId")
        if not order_id:
            raise RuntimeError("请先购买并确认商品")
        print(create_checkout(config, order_id))
        return 0

    paid_claim = re.fullmatch(r"(?:我已付款|已付款)(?:\s+([^\s]+))?", text)
    if paid_claim:
        order_id = paid_claim.group(1) or config.get("lastOrderId")
        if not order_id:
            raise RuntimeError("请先购买并确认商品")
        order_token = config.get("orders", {}).get(order_id)
        session = config.get("paymentSessions", {}).get(order_id)
        if not order_token or not session:
            raise RuntimeError(f"请先说：付款 {order_id}")
        if session.get("provider") != "mock":
            print("已记录你的提示；真实付款仍需等待支付平台官方回调确认。")
            return 0
        checkout = urllib.parse.urlparse(session["checkoutUrl"])
        secret = urllib.parse.parse_qs(checkout.query).get("secret", [""])[0]
        result = request(config, "POST", f"/api/mock-pay/{urllib.parse.quote(order_id)}", {"secret": secret})["order"]
        print(f"已记录模拟付款，订单状态：{result['status']}（simulated）。商家现在可以看到并接单。")
        return 0

    order_status = re.fullmatch(r"订单(?:\s+([^\s]+))?", text)
    if order_status:
        order_id = order_status.group(1) or config.get("lastOrderId")
        if not order_id:
            raise RuntimeError("本机没有最近订单")
        order_token = config.get("orders", {}).get(order_id)
        result = request(config, "GET", f"/api/orders/{urllib.parse.quote(order_id)}", token=order_token)["order"]
        print(f"订单 {order_id}\n状态：{result['status']}\n付款验证：{result.get('paymentVerification') or '未付款'}\n金额：{money(result['totalMinor'], result['currency'])}")
        return 0

    complete = re.fullmatch(r"确认收货(?:\s+([^\s]+))?", text)
    if complete:
        order_id = complete.group(1) or config.get("lastOrderId")
        if not order_id:
            raise RuntimeError("本机没有最近订单")
        order_token = config.get("orders", {}).get(order_id)
        result = request(config, "POST", f"/api/orders/{urllib.parse.quote(order_id)}/status", {"status": "completed", "fulfilledOnTime": True}, order_token)["order"]
        print(f"已确认收货，订单状态：{result['status']}")
        return 0

    dispute = re.fullmatch(r"发起争议\s+([^\s]+)", text)
    if dispute:
        order_id = dispute.group(1)
        order_token = config.get("orders", {}).get(order_id)
        result = request(config, "POST", f"/api/orders/{urllib.parse.quote(order_id)}/status", {"status": "disputed"}, order_token)["order"]
        print(f"争议已记录，订单状态：{result['status']}")
        return 0

    comment = re.fullmatch(r"评论\s+([^\s]+)\s+(.+)", text)
    if comment:
        order_id = comment.group(1)
        order_token = config.get("orders", {}).get(order_id)
        order = request(config, "GET", f"/api/orders/{urllib.parse.quote(order_id)}", token=order_token)["order"]
        result = request(config, "POST", f"/api/listings/{urllib.parse.quote(order['listingId'])}/comments", {
            "orderId": order_id,
            "authorId": config.get("buyerId", ""),
            "body": comment.group(2),
        }, order_token)["comment"]
        label = "已验证成交评论" if result["verifiedPurchase"] else "模拟成交评论" if result.get("simulatedPurchase") else "未验证讨论"
        print(f"评论已发布（{label}）")
        return 0

    if re.search(r"(?:找|搜索|想买|我要买|购买)", text):
        print(search(config, text))
        return 0

    raise RuntimeError("没理解。可以说：找300元以内的电动牙刷、看 <商品ID>、买 <商品ID>、确认买 <商品ID>、付款 <订单ID>。")


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except (RuntimeError, urllib.error.URLError) as exc:
        print(f"失败：{exc}", file=sys.stderr)
        raise SystemExit(1)
