// Local mock: runs the real Worker code with in-memory fakes (no Cloudflare account needed).
// Fake "AI" is keyword-based, so answers are crude; this is for testing the UI and the flow only.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../src/index";
import { fakeEnv } from "./fakes";
const root = fileURLToPath(new URL("../public", import.meta.url) as any);
const env: any = fakeEnv({ ALLOWED_ORIGINS: "http://localhost:8787" } as any);
createServer(async (req, res) => {
  const url = new URL(req.url!, "http://localhost:8787");
  if (url.pathname.startsWith("/api/")) {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers as any, body: req.method === "GET" ? undefined : body }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  if (url.pathname === "/" || url.pathname === "/es/") {
    const es = url.pathname === "/es/";
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html lang="${es ? "es" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cosmo Dental (test page)</title></head><body style="font-family:sans-serif;padding:16px"><h1>Cosmo Dental (test page)</h1><script src="/widget.js" defer></script></body></html>`); return;
  }
  const f = join(root, url.pathname);
  if (existsSync(f)) { res.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html" }); res.end(readFileSync(f)); return; }
  res.writeHead(404); res.end();
}).listen(8787, () => console.log("Mock assistant: http://localhost:8787  (admin: /admin.html, token: test-token)"));