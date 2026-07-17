import { DurableObject } from "cloudflare:workers";

const DEFAULT_TTL_SECONDS = 300;
const AGENT_TTL_SECONDS = 60;

const agentKey = (id) => `agent:${id}`;
const aliasKey = (name) => `alias:${name}`;
const inboxKey = (id) => `inbox:${id}`;
const peerKey = (id) => `peer:${id}`;

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
    this.storage = state.storage;
  }

  async purgeExpired() {
    const current = Date.now() / 1000;
    const agents = await this.storage.list({ prefix: "agent:" });
    for (const [key, agent] of agents) {
      if (Number(agent.expires_at || 0) > current) continue;
      await this.storage.delete(key);
      await this.storage.delete(peerKey(agent.id));
      for (const alias of agent.aliases || []) {
        if ((await this.storage.get(aliasKey(alias))) === agent.id) {
          await this.storage.delete(aliasKey(alias));
        }
      }
    }

    const inboxes = await this.storage.list({ prefix: "inbox:" });
    for (const [key, messages] of inboxes) {
      const live = (messages || []).filter(
        (message) => Number(message.expires_at || 0) > current,
      );
      if (live.length) await this.storage.put(key, live);
      else await this.storage.delete(key);
    }
  }

  async activeAgents() {
    const entries = await this.storage.list({ prefix: "agent:" });
    return Array.from(entries.values()).sort((a, b) =>
      String(a.name || a.id).localeCompare(String(b.name || b.id)),
    );
  }

  async resolveName(name) {
    const value = String(name || "").trim();
    if (!value) return "";
    if (value === "all" || value === "大家") return "all";
    const alias = await this.storage.get(aliasKey(value));
    if (alias) return alias;
    return (await this.storage.get(agentKey(value))) ? value : "";
  }

  async displayName(id) {
    return (await this.storage.get(agentKey(id)))?.name || id;
  }

  async fetch(request) {
    await this.purgeExpired();
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, time: Math.floor(Date.now() / 1000) });
      }

      if (request.method === "GET" && url.pathname === "/agents") {
        return json({ agents: await this.activeAgents() });
      }

      if (request.method === "GET" && url.pathname === "/status") {
        const rawAgent = url.searchParams.get("agent");
        if (!rawAgent) return json({ error: "missing agent query parameter" }, 400);
        const agentId = await this.resolveName(rawAgent);
        if (!agentId || agentId === "all") {
          return json({ error: `unknown agent: ${rawAgent}` }, 404);
        }

        const messages = (await this.storage.get(inboxKey(agentId))) || [];
        const bySender = new Map();
        for (const message of messages) {
          const sender = message.from;
          const current = bySender.get(sender) || {
            id: sender,
            name: message.from_name || sender,
            count: 0,
          };
          current.count += 1;
          bySender.set(sender, current);
        }
        return json({
          count: messages.length,
          senders: Array.from(bySender.values()),
        });
      }

      if (request.method === "GET" && url.pathname === "/inbox") {
        const rawAgent = url.searchParams.get("agent");
        if (!rawAgent) return json({ error: "missing agent query parameter" }, 400);
        const agentId = await this.resolveName(rawAgent);
        if (!agentId || agentId === "all") {
          return json({ error: `unknown agent: ${rawAgent}` }, 404);
        }
        const messages = (await this.storage.get(inboxKey(agentId))) || [];
        await this.storage.delete(inboxKey(agentId));
        for (const message of messages) {
          await this.storage.put(peerKey(agentId), message.from);
        }
        return json({ messages, burned: messages.length });
      }

      if (request.method === "POST" && url.pathname === "/register") {
        const data = await readJson(request);
        const id = String(data.id || "").trim();
        if (!id) return json({ error: "missing id" }, 400);
        const ttl = clampTtl(data.ttl_seconds, AGENT_TTL_SECONDS);
        const now = Math.floor(Date.now() / 1000);
        const aliases = Array.from(
          new Set(
            [id, data.name, ...(Array.isArray(data.aliases) ? data.aliases : [])]
              .map((name) => String(name || "").trim())
              .filter(Boolean),
          ),
        );

        for (const alias of aliases) {
          const owner = await this.storage.get(aliasKey(alias));
          if (owner && owner !== id) {
            return json({ error: `name already in use: ${alias}` }, 409);
          }
        }

        const previous = await this.storage.get(agentKey(id));
        for (const alias of previous?.aliases || []) {
          if (!aliases.includes(alias) && (await this.storage.get(aliasKey(alias))) === id) {
            await this.storage.delete(aliasKey(alias));
          }
        }

        const agent = {
          id,
          name: String(data.name || id).trim(),
          aliases,
          last_seen: now,
          expires_at: now + ttl,
        };
        await this.storage.put(agentKey(id), agent);
        for (const alias of aliases) await this.storage.put(aliasKey(alias), id);
        return json({ ok: true, agent });
      }

      if (request.method === "POST" && url.pathname === "/send") {
        const data = await readJson(request);
        const rawFrom = String(data.from || "").trim();
        const from = await this.resolveName(rawFrom);
        if (!from || from === "all") {
          return json({ error: `unknown sender: ${rawFrom}` }, 404);
        }

        const rawTo = String(data.to || "").trim();
        let to = rawTo ? await this.resolveName(rawTo) : await this.storage.get(peerKey(from));
        if (to && to !== "all" && !(await this.storage.get(agentKey(to)))) to = "";
        if (!to && rawTo) return json({ error: `unknown recipient: ${rawTo}` }, 404);

        const body = String(data.body || "");
        if (!to || !body) return json({ error: "to and body are required" }, 400);

        const ttl = clampTtl(data.ttl_seconds, DEFAULT_TTL_SECONDS);
        const now = Math.floor(Date.now() / 1000);
        const fromName = await this.displayName(from);
        const message = {
          id: messageId(),
          from,
          to,
          from_name: fromName,
          to_name: to === "all" ? "all" : await this.displayName(to),
          body,
          text: `@codexping ${fromName}问候：${body}`,
          created_at: now,
          expires_at: now + ttl,
        };

        let targets = to === "all" ? (await this.activeAgents()).map((agent) => agent.id) : [to];
        targets = targets.filter((agentId) => agentId && agentId !== from);

        for (const agentId of targets) {
          const messages = (await this.storage.get(inboxKey(agentId))) || [];
          messages.push(message);
          await this.storage.put(inboxKey(agentId), messages);
          await this.storage.put(peerKey(agentId), from);
        }
        if (to !== "all") await this.storage.put(peerKey(from), to);

        return json({ ok: true, message_id: message.id, queued_for: targets });
      }

      return json({ error: "not found" }, 404);
    } catch (error) {
      return json({ error: error.message || String(error) }, 400);
    }
  }
}

export default {
  async fetch(request, env) {
    const id = env.RELAY_ROOM.idFromName("global");
    const room = env.RELAY_ROOM.get(id);
    return room.fetch(request);
  },
};
