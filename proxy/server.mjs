/**
 * 本地/自建服务器启动器（Node 18+）
 *
 *   $env:DEEPSEEK_API_KEY = "sk-..."
 *   node server.mjs
 *
 * 默认监听 http://127.0.0.1:8787，逻辑与 Cloudflare Worker 完全相同。
 * 放到自己的服务器上时，前面套一层 Nginx/Caddy 做 HTTPS 即可。
 */
import http from "node:http";
import worker from "./worker.js";

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

const env = {
  ...process.env,
  ALLOWED_ORIGINS:
    process.env.ALLOWED_ORIGINS ??
    "http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:8080,http://localhost:8080,http://127.0.0.1:19387",
};

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    const request = new Request(`http://${req.headers.host || `${host}:${port}`}${req.url}`, {
      method: req.method,
      headers: {
        ...Object.fromEntries(
          Object.entries(req.headers).filter(([, v]) => typeof v === "string"),
        ),
        "X-Forwarded-For": req.socket.remoteAddress || "",
      },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });

    const response = await worker.fetch(request, env);

    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) {
      res.end();
      return;
    }
    // 逐块转发，保持流式
    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    }
    res.end(JSON.stringify({ error: "proxy_crash", detail: String(error?.message || error) }));
  }
});

server.listen(port, host, () => {
  console.log(`PRISM proxy listening on http://${host}:${port}`);
  console.log(`  health : curl http://${host}:${port}/health`);
  console.log(`  key    : ${process.env.DEEPSEEK_API_KEY ? "已配置" : "未配置（/chat 会返回 500）"}`);
  console.log(`  origins: ${env.ALLOWED_ORIGINS}`);
});
