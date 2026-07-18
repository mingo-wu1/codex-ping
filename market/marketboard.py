#!/usr/bin/env python3
"""Small natural-language client for Codex Market Board."""

from __future__ import annotations

import json
import os
import re
import sys
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
    headers = {"accept": "application/json"}
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
    headers = {"content-type": content_type, "authorization": f"Bearer {token_value}", "accept": "application/json"}
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


def money(minor, currency):
    return f"{minor / 100:.2f} {currency}"


def search(config, text):
    budget = re.search(r"(\d+(?:\.\d+)?)\s*元(?:以内|以下)?", text)
    query = re.sub(r"(?:找|搜索|想买|我要买|购买)", " ", text)
    if budget:
        query = query.replace(budget.group(0), " ")
    query = " ".join(query.replace("的", " ").split())
    synonyms = {"电动牙刷": "toothbrush", "牙刷": "toothbrush"}
    for source, target in synonyms.items():
        query = query.replace(source, target)
    params = {"q": query, "sort": "trust"}
    if budget:
        params.update({"max_price_minor": str(round(float(budget.group(1)) * 100)), "currency": "CNY"})
    result = request(config, "GET", "/api/listings?" + urllib.parse.urlencode(params))
    listings = result.get("listings", [])
    if not listings:
        return "没有找到符合条件的公开商品。"
    lines = []
    for index, item in enumerate(listings[:10], 1):
        stats = item["ranking"]["explanation"]
        lines.append(
            f"{index}. {item['title']}｜{money(item['priceMinor'], item['currency'])}｜"
            f"{item['merchant']['displayName']}｜真实付款样本 {stats['sampleSize']}｜{item['id']}"
        )
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
        print(f"商家已登记：{result['merchant']['displayName']}（等待验证）")
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
        print(f"商品已提交审核：{item['title']}｜{money(item['priceMinor'], item['currency'])}｜{item['id']}")
        return 0

    if text == "商家订单":
        merchant_config = config.get("merchant")
        if not merchant_config:
            raise RuntimeError("请先完成商家入驻")
        orders = request(config, "GET", f"/api/merchants/{merchant_config['id']}/orders", token=merchant_config["token"])["orders"]
        if not orders:
            print("暂无订单。")
        else:
            print("\n".join(f"{item['id']}｜{item['title']} × {item['quantity']}｜{item['status']}｜{money(item['totalMinor'], item['currency'])}" for item in orders))
        return 0

    merchant_action = re.fullmatch(r"(接单|已发货|退款)\s+([^\s]+)", text)
    if merchant_action:
        merchant_config = config.get("merchant")
        if not merchant_config:
            raise RuntimeError("请先完成商家入驻")
        status = {"接单": "accepted", "已发货": "fulfilled", "退款": "refunded"}[merchant_action.group(1)]
        result = request(config, "POST", f"/api/orders/{urllib.parse.quote(merchant_action.group(2))}/status", {"status": status}, merchant_config["token"])["order"]
        print(f"订单状态已更新：{result['status']}")
        return 0

    listing = re.fullmatch(r"看\s+([^\s]+)", text)
    if listing:
        item = request(config, "GET", f"/api/listings/{urllib.parse.quote(listing.group(1))}")["listing"]
        stats = item["ranking"]["explanation"]
        print(f"{item['title']}\n{item['summary']}\n价格：{money(item['priceMinor'], item['currency'])}\n商家：{item['merchant']['displayName']}\n合规：{item['compliance']['status']} / {item['compliance']['policyId']} v{item['compliance']['policyVersion']}\n真实付款样本：{stats['sampleSize']}，退款率：{stats['refundRate']:.1%}，争议率：{stats['disputeRate']:.1%}")
        return 0

    buy = re.fullmatch(r"确认买\s+([^\s]+)(?:\s+(\d+))?", text)
    if buy:
        if not config.get("buyerId"):
            raise RuntimeError("请先说：我叫<名字>")
        result = request(config, "POST", "/api/orders", {
            "listingId": buy.group(1),
            "quantity": int(buy.group(2) or 1),
            "buyerId": config["buyerId"],
            "buyerConfirmed": True,
        })
        order = result["order"]
        config.setdefault("orders", {})[order["id"]] = result["orderToken"]
        save_config(config)
        print(f"订单已创建：{order['id']}\n应付：{money(order['totalMinor'], order['currency'])}\n需要付款时说：付款 {order['id']}")
        return 0

    preview = re.fullmatch(r"(?:预览|买)\s+([^\s]+)(?:\s+(\d+))?", text)
    if preview:
        result = request(config, "POST", "/api/orders/preview", {"listingId": preview.group(1), "quantity": int(preview.group(2) or 1)})["preview"]
        print(f"{result['title']} × {result['quantity']}\n合计：{money(result['totalMinor'], result['currency'])}\n确认无误后说：确认买 {result['listingId']} {result['quantity']}")
        return 0

    pay = re.fullmatch(r"付款\s+([^\s]+)", text)
    if pay:
        order_id = pay.group(1)
        order_token = config.get("orders", {}).get(order_id)
        if not order_token:
            raise RuntimeError("本机没有这个订单的访问凭证")
        result = request(config, "POST", f"/api/orders/{urllib.parse.quote(order_id)}/checkout", {}, order_token)
        qr_path = None
        if result.get("checkoutQrSvg"):
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            qr_path = CONFIG_DIR / f"{order_id}-checkout.svg"
            qr_path.write_text(result["checkoutQrSvg"], encoding="utf-8")
        provider_note = "开发测试二维码，不会扣真实资金。" if result.get("provider") == "mock" else f"支付提供商：{result.get('provider', 'external')}。"
        qr_note = f"\n二维码：{qr_path}" if qr_path else ""
        print(f"请核对后在支付提供商页面完成付款：\n{result['checkoutUrl']}{qr_note}\n{provider_note}")
        return 0

    order_status = re.fullmatch(r"订单\s+([^\s]+)", text)
    if order_status:
        order_id = order_status.group(1)
        order_token = config.get("orders", {}).get(order_id)
        result = request(config, "GET", f"/api/orders/{urllib.parse.quote(order_id)}", token=order_token)["order"]
        print(f"订单 {order_id}\n状态：{result['status']}\n金额：{money(result['totalMinor'], result['currency'])}")
        return 0

    complete = re.fullmatch(r"确认收货\s+([^\s]+)", text)
    if complete:
        order_id = complete.group(1)
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
        label = "已成交评论" if result["verifiedPurchase"] else "未验证讨论"
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
