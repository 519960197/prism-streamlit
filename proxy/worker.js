/**
 * PRISM 代理服务 —— 唯一持有 DeepSeek 密钥的地方
 *
 * 运行环境：
 *   1) Cloudflare Workers（推荐）：把本文件内容贴进 Workers 编辑器即可
 *   2) 任何装了 Node 18+ 的机器：node server.mjs
 *
 * 环境变量：
 *   DEEPSEEK_API_KEY   必填，形如 sk-xxxxxxxx
 *   ALLOWED_ORIGINS    逗号分隔的前端来源白名单；填 * 表示不限制（不推荐）
 *   DEEPSEEK_BASE      可选，默认 https://api.deepseek.com
 *   DEFAULT_MODEL      可选，默认 deepseek-chat
 */

const ALLOWED_MODELS = new Set(["deepseek-chat", "deepseek-reasoner"]);
const MAX_MESSAGES = 20;
const MAX_TOTAL_CHARS = 16000;
const MAX_OUTPUT_TOKENS = 2000;
const UPSTREAM_TIMEOUT_MS = 90000;

/* 简易限流：每个实例内存计数，实例回收即清零。
   只用来挡住"一个脚本狂刷"这种低级滥用，不是强一致的配额。 */
const hits = new Map();
function rateLimited(ip, limit = 30, windowMs = 60000) {
  const now = Date.now();
  const bucket = hits.get(ip);
  if (!bucket || now - bucket.start > windowMs) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  if (hits.size > 5000) hits.clear();
  return bucket.count > limit;
}

function corsHeaders(allowOrigin) {
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status, allowOrigin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(allowOrigin ? corsHeaders(allowOrigin) : {}),
    },
  });
}

function resolveAllowOrigin(request, env) {
  const raw = (env.ALLOWED_ORIGINS || "").trim();
  if (!raw) return "";
  if (raw === "*") return "*";
  const origin = request.headers.get("Origin") || "";
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : "";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowOrigin = resolveAllowOrigin(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: allowOrigin ? corsHeaders(allowOrigin) : {} });
    }

    if (url.pathname === "/health") {
      return json(
        {
          ok: true,
          service: "prism-proxy",
          keyConfigured: Boolean(env.DEEPSEEK_API_KEY),
          model: env.DEFAULT_MODEL || "deepseek-chat",
          origin: allowOrigin || null,
        },
        200,
        allowOrigin,
      );
    }

    if (!allowOrigin) {
      return json({ error: "origin_not_allowed", hint: "把前端域名加进 ALLOWED_ORIGINS" }, 403, "");
    }

    if (url.pathname !== "/chat") return json({ error: "not_found" }, 404, allowOrigin);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, allowOrigin);

    if (!env.DEEPSEEK_API_KEY) {
      return json({ error: "missing_api_key", hint: "设置 DEEPSEEK_API_KEY 环境变量/Secret" }, 500, allowOrigin);
    }

    const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
    if (rateLimited(ip)) {
      return json({ error: "rate_limited", hint: "请求过于频繁，请稍后再试" }, 429, allowOrigin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return json({ error: "invalid_json" }, 400, allowOrigin);
    }

    const messages = payload?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "invalid_messages" }, 400, allowOrigin);
    }
    if (messages.length > MAX_MESSAGES) {
      return json({ error: "too_many_messages", limit: MAX_MESSAGES }, 400, allowOrigin);
    }
    const totalChars = messages.reduce((sum, m) => sum + String(m?.content || "").length, 0);
    if (totalChars > MAX_TOTAL_CHARS) {
      return json({ error: "too_long", limit: MAX_TOTAL_CHARS }, 413, allowOrigin);
    }

    const requestedModel = String(payload?.model || env.DEFAULT_MODEL || "deepseek-chat");
    const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : "deepseek-chat";
    const maxTokens = Math.min(Number(payload?.max_tokens) || 1200, MAX_OUTPUT_TOKENS);

    const base = (env.DEEPSEEK_BASE || "https://api.deepseek.com").replace(/\/+$/, "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    let upstream;
    try {
      upstream = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model,
          messages: messages.map((m) => ({ role: String(m.role), content: String(m.content ?? "") })),
          stream: true,
          temperature: typeof payload?.temperature === "number" ? payload.temperature : 0.3,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      return json({ error: "upstream_unreachable", detail: String(error?.message || error) }, 502, allowOrigin);
    }

    if (!upstream.ok) {
      clearTimeout(timer);
      const detail = await upstream.text().catch(() => "");
      return json({ error: "upstream_error", status: upstream.status, detail: detail.slice(0, 500) }, 502, allowOrigin);
    }

    // 直接透传 SSE，前端按行解析；不在代理里缓冲，保证逐字返回
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders(allowOrigin),
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  },
};
