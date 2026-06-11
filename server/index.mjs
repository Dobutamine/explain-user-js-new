// Production server for the Explain web app.
//
// In dev, `vite` serves the app and a middleware proxy handles POST /api/chat
// (see explainBotApi in vite.config.ts). A production build (`npm run build` ->
// dist/) has neither, so this tiny zero-dependency Node server provides both:
//
//   1. serves the static dist/ build (with COOP/COEP so SharedArrayBuffer /
//      crossOriginIsolated works — same headers vite sets in dev/preview), and
//   2. hosts POST /api/chat, forwarding to the Explain bot's /v1/ask with the
//      API key injected SERVER-SIDE (never shipped to the browser bundle).
//
// The bot's reply is returned verbatim; the browser parses any embedded
// ```explain-command``` blocks itself (see src/services/botCommands.ts), so this
// proxy stays a dumb passthrough — identical contract to the dev proxy.
//
// Env (set in the process environment, or use `node --env-file=.env.local`):
//   EXPLAIN_BOT_URL       e.g. http://lucys-mac-mini.tail990503.ts.net:8091
//   EXPLAIN_BOT_API_KEY   the bot's X-API-Key
//   PORT                  listen port (default 8080)
//   DIST_DIR              static dir (default ./dist)
//
// Run:  npm run build  &&  node --env-file=.env.local server/index.mjs

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const DIST = path.resolve(ROOT, process.env.DIST_DIR || "dist");
const PORT = Number(process.env.PORT || 8080);
const BOT_URL = process.env.EXPLAIN_BOT_URL || "";
const BOT_KEY = process.env.EXPLAIN_BOT_API_KEY || "";

// crossOriginIsolated === true activates SharedArrayBuffer (the preferred
// realtime transport; the app falls back to transferable ArrayBuffers without
// it, but we match dev for parity). Mirrors `crossOriginIsolation` in vite.config.ts.
const COI_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
};

// ---- POST /api/chat -> bot /v1/ask (API key stays server-side) ----
function handleChat(req, res) {
  const reply = (code, obj) => {
    res.writeHead(code, { ...COI_HEADERS, "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (!BOT_URL || !BOT_KEY) {
    return reply(500, {
      error: "explain bot not configured — set EXPLAIN_BOT_URL and EXPLAIN_BOT_API_KEY",
    });
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    try {
      const { prompt, conversation_id, context } = JSON.parse(raw || "{}");
      // Prepend the live patient-state block so the bot can answer about "this
      // patient" (identical to the dev proxy).
      const fullPrompt = context
        ? `Current simulated patient state:\n${context}\n\n---\n\n${prompt ?? ""}`
        : (prompt ?? "");
      const upstream = await fetch(`${BOT_URL}/v1/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": BOT_KEY },
        body: JSON.stringify({ prompt: fullPrompt, ...(conversation_id ? { conversation_id } : {}) }),
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, {
        ...COI_HEADERS,
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      });
      res.end(text);
    } catch (e) {
      reply(502, { error: `explain bot unreachable: ${String(e)}` });
    }
  });
}

// ---- static dist/ with SPA fallback ----
function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  // resolve within DIST; reject traversal
  let filePath = path.resolve(DIST, "." + urlPath);
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  let stat = fs.existsSync(filePath) && fs.statSync(filePath);
  if (stat && stat.isDirectory()) {
    filePath = path.join(filePath, "index.html");
    stat = fs.existsSync(filePath) && fs.statSync(filePath);
  }
  // SPA fallback: unknown non-asset path -> index.html (client-side routing)
  if (!stat) {
    filePath = path.join(DIST, "index.html");
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, COI_HEADERS).end("not found — run `npm run build` first");
      return;
    }
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    ...COI_HEADERS,
    "content-type": MIME[ext] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/api/chat")) {
    if (req.method !== "POST") {
      res.writeHead(405, COI_HEADERS).end("method not allowed");
      return;
    }
    return handleChat(req, res);
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, COI_HEADERS).end("method not allowed");
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Explain app server on http://localhost:${PORT}`);
  console.log(`  static dir : ${path.relative(ROOT, DIST)}/`);
  console.log(`  /api/chat  : ${BOT_URL ? `-> ${BOT_URL}/v1/ask` : "NOT configured (set EXPLAIN_BOT_URL/KEY)"}`);
  if (!fs.existsSync(DIST)) console.log(`  ! ${path.relative(ROOT, DIST)}/ missing — run \`npm run build\``);
});
