#!/usr/bin/env python3
import argparse
import json
import os
import re
import time
import urllib.parse
import urllib.request
from urllib.error import HTTPError

BASE = os.environ.get(
    "CODEX_PING_BASE",
    "https://codex-world-bus.mingowu1.workers.dev",
)
STATE = os.path.expanduser("~/.codexping.json")


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
    for name in sorted(names, key=len, reverse=True):
        if text.startswith(name) and text != name:
            return name, text[len(name) :].strip(" ，,：:")
    if len(text) >= 3 and re.fullmatch(r"[\u4e00-\u9fff]{2}", text[:2]):
        return text[:2], text[2:].strip(" ，,：:")
    return "", text


def load_me():
    try:
        with open(STATE, "r", encoding="utf-8") as file:
            return json.load(file).get("me")
    except FileNotFoundError:
        return None


def save_me(name):
    with open(STATE, "w", encoding="utf-8") as file:
        json.dump({"me": name}, file, ensure_ascii=False)


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


def show_messages(messages, json_output=False):
    if json_output:
        print(json.dumps({"messages": messages}, ensure_ascii=False))
        return
    for msg in messages:
        print(msg.get("body") or msg.get("text"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("text", nargs="+", help="例如：小明在吗？")
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true", dest="json_output")
    parser.add_argument("--timeout", type=int, default=120, help=argparse.SUPPRESS)
    args = parser.parse_args()

    text = " ".join(args.text).strip()
    base = args.base.rstrip("/")

    if text in {"在线", "谁在", "who"}:
        agents = request("GET", base + "/agents").get("agents", [])
        agents = sorted(agents, key=lambda agent: agent.get("name") or agent.get("id") or "")
        if args.json_output:
            print(json.dumps({"agents": agents}, ensure_ascii=False))
        elif agents:
            print("最近活跃：")
            for agent in agents:
                print(f"- {agent.get('name') or agent.get('id')}")
        else:
            print("暂无活跃成员")
        return

    register_match = re.fullmatch(r"(.+?)\s*注册", text)
    if text == "注册" or register_match:
        name = (register_match.group(1).strip() if register_match else load_me())
        if not name:
            raise SystemExit("注册格式：./hw 大明注册")
        save_me(name)
        register(base, name)
        print(f"已登录 {name}")
        return

    me = load_me()
    if not me:
        raise SystemExit("先注册：./hw 大明注册")
    register(base, me)

    if text == "收":
        messages = inbox(base, me)
        show_messages(messages, args.json_output)
        if not messages and not args.json_output:
            print("没有消息")
        return

    agents = request("GET", base + "/agents").get("agents", [])
    names = [agent.get("name") for agent in agents] + [
        alias for agent in agents for alias in agent.get("aliases", [])
    ]
    to, body = split_target(text, [name for name in names if name and name != me])
    if to == me:
        raise SystemExit(f"你现在就是{me}，不能发给自己。先切换身份：./hw 你的名字注册")
    if not to:
        first_word = re.split(r"[，,：:\s]", text, maxsplit=1)[0]
        if first_word and first_word != text:
            raise SystemExit(f"没找到 {first_word}，先让对方注册：./hw {first_word}注册")
    result = request("POST", base + "/send", {
        "from": me,
        "to": to,
        "body": body,
        "ttl_seconds": 3600,
    })
    if not result.get("queued_for"):
        raise SystemExit(f"没人收到。你现在是{me}；如果想换人，先运行：./hw 名字注册")
    print(body)
    if body in {"在吗", "在吗？", "在不在", "在不在？"}:
        deadline = time.time() + args.timeout
        while time.time() < deadline:
            messages = inbox(base, me)
            replies = [msg for msg in messages if msg.get("from") == to]
            if replies:
                show_messages(replies, args.json_output)
                return
            time.sleep(2)
        print("不在线")
        return


if __name__ == "__main__":
    main()
