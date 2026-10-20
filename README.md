# PRISM · 事件研判工作台

危机公关场景的事件研判工作台。前端是单文件 HTML（`app.html`），后端能力（AI）走一个独立代理，密钥只存在于代理环境变量中。

## 目录

```
.
├── streamlit_app.py        # Streamlit 入口，把 app.html 塞进 iframe
├── app.html                # 全部界面与交互（纯前端，可独立打开）
├── requirements.txt        # streamlit>=1.40,<2
├── .streamlit/config.toml  # 浅色主题 + 上传上限
└── proxy/
    ├── worker.js           # 代理：藏 Key、SSE 透传、CORS 白名单、限流
    ├── server.mjs          # 本地/自建服务器启动器（Node 18+）
    └── wrangler.toml       # Cloudflare Workers 配置
```

## 部署到 Streamlit Cloud

1. 把本仓库推到 GitHub（公开仓库）。
2. 打开 https://share.streamlit.io/ ，用 GitHub 登录并授权。
3. **Create app** → 选仓库、分支 `main`、**Main file path** 填 `streamlit_app.py`。
4. Deploy，等 2–5 分钟，得到 `https://<子域名>.streamlit.app`。
5. 之后每次 push 到 `main` 都会自动重新部署，地址不变。

> 免费版应用在长时间无访问后会休眠，首次打开需要点一下唤醒，等待 20–30 秒。

### 备用入口：GitHub Pages

`app.html` 是自包含的静态页，也可以直接由 Pages 托管（没有休眠、打开更快）：

仓库 Settings → Pages → Source 选 `main` / `/(root)` → 得到 `https://<用户名>.github.io/<仓库>/app.html`。

## 接入 API（DeepSeek 流式）

架构：**浏览器 → 你的代理（持 Key）→ DeepSeek**。浏览器永远看不到密钥。

### 1. 拿 Key

DeepSeek 开放平台创建 API Key（`sk-...`）。**不要写进任何会进 git 的文件。**

### 2. 部署代理（Cloudflare Workers，免费，无需信用卡）

1. 登录 https://dash.cloudflare.com/ → **Workers & Pages** → **Create** → **Worker** → Deploy。
2. **Edit code**，把 `proxy/worker.js` 的内容整个粘进去 → Deploy。
3. **Settings → Variables and Secrets** 添加两个变量（`DEEPSEEK_API_KEY` 选 **Encrypt/Secret**）：
   - `DEEPSEEK_API_KEY` = `sk-...`
   - `ALLOWED_ORIGINS` = `https://519960197.github.io,https://<你的app>.streamlit.app`
4. 得到地址 `https://prism-proxy.<你的子域>.workers.dev`，先自测：

   ```
   curl https://prism-proxy.<子域>.workers.dev/health
   ```

   返回 `{"ok":true,"keyConfigured":true,...}` 说明密钥已生效。

### 3. 前端指向代理

打开 `app.html`，把这一行改成你的代理地址（末尾要 `/chat`）：

```js
const PRISM_API_ENDPOINT = "https://prism-proxy.<你的子域>.workers.dev/chat";
```

保存并 push，Streamlit Cloud 会自动重建。前端检测到占位符 `REPLACE-ME` 时会自动回退到本地规则，所以改之前页面也是可用的。

### 4. 本地联调（可选）

```powershell
$env:DEEPSEEK_API_KEY="sk-..."
node proxy/server.mjs          # 监听 127.0.0.1:8787
```

然后用浏览器打开 `app.html?api=http://127.0.0.1:8787/chat`，即可走本地代理。

其他环境（自己的服务器 / VPS）直接用同一份 `server.mjs`，前面套 Nginx/Caddy 做 HTTPS 即可。

## 说明与限制

- **本地规则仍然保留**：`识别并判断等级` 走的是浏览器内的关键词规则，不联网；AI 只用于对话区的追问分析。
- **降级策略**：代理不可用、Key 失效、超时（60s）时，对话区自动回退到本地提示，不会白屏。
- **限流**：代理侧按 IP 每分钟 30 次、单次最多 2000 输出 token、prompt 上限 16000 字符，避免 Key 被刷爆。要更强的一致限流可挂 Cloudflare KV。
- **数据**：所有记录存在浏览器 `localStorage`，换设备/换域名（streamlit.app ↔ github.io）不互通；多人共享需要另接数据库。
- **不要**把 Key 写进 `app.html`、`streamlit_app.py` 或任何提交到 git 的文件。`.streamlit/secrets.toml` 已在 `.gitignore` 中。
