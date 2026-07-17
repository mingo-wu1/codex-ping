#!/usr/bin/env python3
import argparse
import json
import os
import re
import time
import urllib.parse
import urllib.request
from urllib.error import HTTPError

DEFAULT_BASE = "https://codex-ping.mingowu1.workers.dev"
STATE = os.path.expanduser("~/.codex-ping/config.json")
LEGACY_STATE = os.path.expanduser("~/.codexping.json")


def load_state():
    for path in (STATE, LEGACY_STATE):
        try:
            with open(path, "r", encoding="utf-8") as file:
                data = json.load(file)
                return data if isinstance(data, dict) else {}
        except (FileNotFoundError, json.JSONDecodeError):
            continue
    return {}


def save_state(data):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


def configured_base():
    return os.environ.get("CODEX_PING_BASE") or load_state().get("server") or DEFAULT_BASE


def request(method, url, data=None):
    body = None if data is None else json.dumps(data, ensure_ascii=False).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={"content-type": "application/json", "user-agent": "codex-ping/0.1"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read().decode())
    except HTTPError as error:
        try:
            payload = json.loads(error.read().decode())
        except Exception:
            payload = {"error": str(error)}
        raise SystemExit(payload.get("error", str(error)))


def split_target(text, names):
    if text.startswith("大家") and text != "大家":
        return "all", text[len("大家") :].strip(" ，,：:")
    for name in sorted(names, key=len, reverse=True):
        if text.startswith(name) and text != name:
            return name, text[len(name) :].strip(" ，,：:")
    if len(text) >= 3 and re.fullmatch(r"[\u4e00-\u9fff]{2}", text[:2]):
        return text[:2], text[2:].strip(" ，,：:")
    return "", text


def parse_identity(text):
    patterns = (
        r"我叫\s*(.+)",
        r"我的名字(?:是|叫)\s*(.+)",
        r"(?:call me|my name is)\s+(.+)",
    )
    for pattern in patterns:
        match = re.fullmatch(pattern, text, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip(" ：:，,。.！!?\"'")
    return ""


def load_me():
    return load_state().get("me")


def save_me(name):
    state = load_state()
    state["me"] = name
    save_state(state)


def register(base, name):
    return request("POST", base + "/register", {
        "id": name,
        "name": name,
        "aliases": [name],
        "ttl_seconds": 3600,
    })


def inbox(base, name):
    q = urllib.parse.urlencode({"agent": name})
    return request("GET", base + "/inbox?" + q).get("messages", [])


def unread_status(base, name):
    q = urllib.parse.urlencode({"agent": name})
    return request("GET", base + "/status?" + q)


def status_signature(status):
    return tuple(
        sorted((sender.get("id"), sender.get("count", 0)) for sender in status.get("senders", []))
    )


def show_unread(status):
    summaries = [
        f"{sender.get('name') or sender.get('id')} {sender.get('count', 0)} 条"
        for sender in status.get("senders", [])
    ]
    if summaries:
        print("新消息：" + "，".join(summaries), flush=True)


def listen(base, name):
    print("正在监听，每 30 秒检查一次。", flush=True)
    previous = ()
    while True:
        try:
            register(base, name)
            status = unread_status(base, name)
            current = status_signature(status)
            if current and current != previous:
                show_unread(status)
            previous = current
        except SystemExit as error:
            print(f"监听暂时断开：{error}", flush=True)
        time.sleep(30)


def show_messages(messages):
    for msg in messages:
        print(msg.get("body") or msg.get("text"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("text", nargs="+", help="例如：小明在吗？")
    parser.add_argument("--base", default=configured_base())
    parser.add_argument("--timeout", type=int, default=120, help=argparse.SUPPRESS)
    args = parser.parse_args()

    text = " ".join(args.text).strip()
    base = args.base.rstrip("/")

    if text == "在线":
        agents = request("GET", base + "/agents").get("agents", [])
        agents = sorted(agents, key=lambda agent: agent.get("name") or agent.get("id") or "")
        if agents:
            print("最近活跃：")
            for agent in agents:
                print(f"- {agent.get('name') or agent.get('id')}")
        else:
            print("暂无活跃成员")
        return

    name = parse_identity(text)
    if name:
        save_me(name)
        register(base, name)
        print(f"已登录 {name}")
        return

    me = load_me()
    if not me:
        raise SystemExit("请先设置身份，例如：我叫大明")
    register(base, me)

    if text == "收":
        messages = inbox(base, me)
        show_messages(messages)
        if not messages:
            print("没有消息")
        return

    if text == "监听":
        listen(base, me)
        return

    agents = request("GET", base + "/agents").get("agents", [])
    names = [agent.get("name") for agent in agents] + [
        alias for agent in agents for alias in agent.get("aliases", [])
    ]
    to, body = split_target(text, [name for name in names if name and name != me])
    if to == me:
        raise SystemExit(f"你现在就是{me}，不能发给自己。请先切换身份。")
    if not to:
        first_word = re.split(r"[，,：:\s]", text, maxsplit=1)[0]
        if first_word and first_word != text:
            raise SystemExit(f"没找到 {first_word}，请让对方先设置身份并上线。")
    result = request("POST", base + "/send", {
        "from": me,
        "to": to,
        "body": body,
        "ttl_seconds": 3600,
    })
    if not result.get("queued_for"):
        raise SystemExit(f"没人收到。你现在是{me}；如果想换人，请先切换身份。")
    print(body)
    if body in {"在吗", "在吗？", "在不在", "在不在？"}:
        deadline = time.time() + args.timeout
        while time.time() < deadline:
            messages = inbox(base, me)
            replies = [msg for msg in messages if msg.get("from") == to]
            if replies:
                show_messages(replies)
                return
            time.sleep(2)
        print("不在线")
        return


if __name__ == "__main__":
    main()
