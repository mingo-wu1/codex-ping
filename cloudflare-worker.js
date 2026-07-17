import { DurableObject } from "cloudflare:workers";

const DEFAULT_TTL_SECONDS = 300;
const AGENT_TTL_SECONDS = 60;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function readJson(request) {
  if (!request.body) return {};
  const text = await request.text();
  if (!text) return {};
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("json body must be an object");
  }
  return data;
}

function clampTtl(value, fallback) {
  const ttl = Number(value || fallback);
  return Math.max(1, Math.min(Math.floor(ttl), 3600));
}

function messageId() {
  return `msg_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export class RelayRoom extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.agents = new Map();
    this.aliases = new Map();
    this.inboxes = new Map();
    this.lastPeers = new Map();
  }

  purgeExpired() {
    const current = Date.now() / 1000;
    for (const [agentId, agent] of this.agents.entries()) {
      if (Number(agent.expires_at || 0) <= current) this.agents.delete(agentId);
    }
    for (const [agentId, messages] of this.inboxes.entries()) {
      const live = messages.filter((message) => Number(message.expires_at || 0) > current);
      if (live.length) this.inboxes.set(agentId, live);
      else this.inboxes.delete(agentId);
    }
  }

  async fetch(request) {
    this.purgeExpired();
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, time: Math.floor(Date.now() / 1000) });
      }

      if (request.method === "GET" && url.pathname === "/agents") {
        return json({ agents: Array.from(this.agents.values()) });
      }

      if (request.method === "GET" && url.pathname === "/inbox") {
        const agentId = this.resolveName(url.searchParams.get("agent"));
        if (!agentId) return json({ error: "missing agent query parameter" }, 400);
        const messages = this.inboxes.get(agentId) || [];
        this.inboxes.delete(agentId);
        for (const message of messages) this.lastPeers.set(agentId, message.from);
        return json({ messages, burned: messages.length });
      }

      if (request.method === "POST" && url.pathname === "/register") {
        const data = await readJson(request);
        const id = String(data.id || "").trim();
        if (!id) return json({ error: "missing id" }, 400);
        const ttl = clampTtl(data.ttl_seconds, AGENT_TTL_SECONDS);
        const now = Math.floor(Date.now() / 1000);
        const aliases = [id, data.name, ...(Array.isArray(data.aliases) ? data.aliases : [])]
          .map((name) => String(name || "").trim())
          .filter(Boolean);
        const agent = {
          id,
          name: String(data.name || id).trim(),
          aliases,
          last_seen: now,
          expires_at: now + ttl,
        };
        this.agents.set(id, agent);
        for (const alias of aliases) this.aliases.set(alias, id);
        return json({ ok: true, agent });
      }

      if (request.method === "POST" && url.pathname === "/send") {
        const data = await readJson(request);
        const from = this.resolveName(data.from);
        const rawTo = String(data.to || "").trim();
        let to = this.resolveName(rawTo);
        const body = String(data.body || "");
        if (!to && rawTo) return json({ error: `unknown recipient: ${rawTo}` }, 404);
        if (!to) to = this.lastPeers.get(from);
        if (!from || !to || !body) {
          return json({ error: "from, to, and body are required" }, 400);
        }

        const ttl = clampTtl(data.ttl_seconds, DEFAULT_TTL_SECONDS);
        const now = Math.floor(Date.now() / 1000);
        const message = {
          id: messageId(),
          from,
          to,
          from_name: this.displayName(from),
          to_name: to === "all" ? "all" : this.displayName(to),
          body,
          text: `@codexping ${this.displayName(from)}问候：${body}`,
          created_at: now,
          expires_at: now + ttl,
        };

        let targets = [to];
        if (to === "all") targets = Array.from(this.agents.keys());
        targets = targets.filter((agentId) => agentId && agentId !== from);

        for (const agentId of targets) {
          const messages = this.inboxes.get(agentId) || [];
          messages.push(message);
          this.inboxes.set(agentId, messages);
          this.lastPeers.set(agentId, from);
        }
        if (to !== "all") this.lastPeers.set(from, to);

        return json({ ok: true, message_id: message.id, queued_for: targets });
      }

      return json({ error: "not found" }, 404);
    } catch (error) {
      return json({ error: error.message || String(error) }, 400);
    }
  }

  resolveName(name) {
    const value = String(name || "").trim();
    if (!value) return "";
    if (value === "all" || value === "大家") return "all";
    return this.aliases.get(value) || value;
  }

  displayName(id) {
    return this.agents.get(id)?.name || id;
  }
}

export default {
  async fetch(request, env) {
    const id = env.RELAY_ROOM.idFromName("global");
    const room = env.RELAY_ROOM.get(id);
    return room.fetch(request);
  },
};
