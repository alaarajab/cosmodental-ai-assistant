import type { PageText } from "./chunk";
import type { Lang } from "./prompt";
import {
  answerQuestion,
  deleteDocument,
  deleteNamespace,
  generate,
  getDocument,
  ingestPages,
  isValidNamespace,
  LIVE,
  logQuestion,
  retrieve,
  type Env,
} from "./rag";
import { smallTalk } from "./smalltalk";
import { smallTalkLinks, suggestLinks, welcomeLinks } from "./links";
import { json, safeEqual } from "./util";

const MAX_QUESTION = 500;
const MAX_PAGES_PER_REQUEST = 10;
const MAX_PAGE_CHARS = 20_000;

/* Best-effort per-IP limit (per Worker instance): 10 questions / minute. */
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 10;
}

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  return allowed.includes(origin)
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        vary: "origin",
      }
    : {};
}

function isAdmin(req: Request, env: Env): boolean {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return Boolean(env.ADMIN_TOKEN) && token.length > 0 && safeEqual(token, env.ADMIN_TOKEN);
}

const asLang = (v: unknown): Lang => (v === "es" ? "es" : "en");

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");

    try {
      /* ---------- Welcome buttons for the chat's first message ---------- */
      if (path === "/api/welcome" && req.method === "GET") {
        return json({ links: welcomeLinks(asLang(url.searchParams.get("lang"))) }, 200, {
          ...cors(req, env),
          "cache-control": "public, max-age=3600",
        });
      }

      /* ---------- Public chat ---------- */
      if (path === "/api/chat") {
        const headers = cors(req, env);
        if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
        if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, headers);

        const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
        if (rateLimited(ip)) return json({ error: "Too many questions. Please wait a minute." }, 429, headers);

        const body = (await req.json().catch(() => ({}))) as { question?: unknown; lang?: unknown };
        const question = typeof body.question === "string" ? body.question.trim() : "";
        if (!question) return json({ error: "Question is required" }, 400, headers);
        if (question.length > MAX_QUESTION) return json({ error: "Question is too long" }, 400, headers);
        const lang = asLang(body.lang);

        // Greetings, thanks, goodbyes: friendly instant reply, no search or LLM (not logged as questions).
        const st = smallTalk(question, lang);
        if (st) {
          return json(
            { answer: st.answer, answered: true, smallTalk: st.kind, sources: [], links: smallTalkLinks(st.kind, st.lang), topScore: 0, latencyMs: 0 },
            200,
            headers,
          );
        }

        const start = Date.now();
        const result = await answerQuestion(env, question, lang);
        const latency = Date.now() - start;
        await logQuestion(env, question, lang, result, latency).catch(() => {});
        const links = suggestLinks(question, result.answer, result.answered, lang);
        return json({ ...result, links, latencyMs: latency }, 200, headers);
      }

      /* ---------- Admin API (Bearer ADMIN_TOKEN) ---------- */
      if (path.startsWith("/api/admin")) {
        if (!isAdmin(req, env)) return json({ error: "Unauthorized" }, 401);

        if (path === "/api/admin/documents" && req.method === "GET") {
          const ns = url.searchParams.get("namespace");
          const cols = "id, title, filename, lang, namespace, chunk_max, chunk_overlap, pages, chunk_count, created_at";
          const stmt = ns
            ? env.DB.prepare(`SELECT ${cols} FROM documents WHERE namespace = ? ORDER BY created_at DESC`).bind(ns)
            : env.DB.prepare(`SELECT ${cols} FROM documents ORDER BY created_at DESC`);
          const { results } = await stmt.all();
          return json({ documents: results });
        }

        if (path === "/api/admin/documents" && req.method === "POST") {
          const b = (await req.json()) as {
            title?: string;
            filename?: string;
            lang?: string;
            pages?: number;
            namespace?: string;
            chunkMax?: number;
            chunkOverlap?: number;
          };
          const title = (b.title ?? "").trim().slice(0, 120);
          if (!title || !b.filename || !b.pages) return json({ error: "title, filename and pages are required" }, 400);
          const namespace = b.namespace ?? LIVE;
          if (!isValidNamespace(namespace)) return json({ error: "namespace must be 'live' or 'exp-...'" }, 400);
          const chunkMax = Math.floor(b.chunkMax ?? 800);
          const chunkOverlap = Math.floor(b.chunkOverlap ?? 150);
          if (chunkMax < 200 || chunkMax > 3000 || chunkOverlap < 0 || chunkOverlap > chunkMax / 2)
            return json({ error: "chunkMax must be 200–3000 and chunkOverlap 0–chunkMax/2" }, 400);
          const id = crypto.randomUUID().slice(0, 8);
          await env.DB.prepare(
            "INSERT INTO documents (id, title, filename, lang, namespace, chunk_max, chunk_overlap, pages, chunk_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
          )
            .bind(id, title, b.filename.slice(0, 200), asLang(b.lang), namespace, chunkMax, chunkOverlap, Math.floor(b.pages))
            .run();
          return json({ id }, 201);
        }

        const pagesMatch = path.match(/^\/api\/admin\/documents\/([\w-]+)\/pages$/);
        if (pagesMatch && req.method === "POST") {
          const docId = pagesMatch[1];
          const doc = await getDocument(env, docId);
          if (!doc) return json({ error: "Document not found" }, 404);
          const b = (await req.json()) as { pages?: PageText[] };
          const pages = (b.pages ?? [])
            .filter((p) => Number.isInteger(p?.page) && typeof p?.text === "string")
            .map((p) => ({ page: p.page, text: p.text.slice(0, MAX_PAGE_CHARS) }));
          if (!pages.length || pages.length > MAX_PAGES_PER_REQUEST)
            return json({ error: `Send 1–${MAX_PAGES_PER_REQUEST} pages per request` }, 400);
          const added = await ingestPages(env, docId, doc, pages);
          return json({ added });
        }

        const docMatch = path.match(/^\/api\/admin\/documents\/([\w-]+)$/);
        if (docMatch && req.method === "DELETE") {
          const removed = await deleteDocument(env, docMatch[1]);
          return json({ removed });
        }

        // Delete a whole experiment namespace (never the live one).
        const nsMatch = path.match(/^\/api\/admin\/namespaces\/([\w-]+)$/);
        if (nsMatch && req.method === "DELETE") {
          const ns = nsMatch[1];
          if (ns === LIVE || !isValidNamespace(ns)) return json({ error: "Only exp-... namespaces can be deleted" }, 400);
          return json(await deleteNamespace(env, ns));
        }

        // Experiment endpoint: ask with custom settings. Not logged, not rate limited.
        // retrieveOnly=true skips the LLM (costs only an embedding → very cheap).
        if (path === "/api/admin/ask" && req.method === "POST") {
          const b = (await req.json()) as {
            question?: string;
            lang?: string;
            namespace?: string;
            topK?: number;
            minScore?: number;
            retrieveOnly?: boolean;
          };
          const question = (b.question ?? "").trim();
          if (!question || question.length > MAX_QUESTION) return json({ error: "Invalid question" }, 400);
          const namespace = b.namespace ?? LIVE;
          if (!isValidNamespace(namespace)) return json({ error: "Invalid namespace" }, 400);
          const topK = b.topK === undefined ? undefined : Math.floor(b.topK);
          if (topK !== undefined && (topK < 1 || topK > 20)) return json({ error: "topK must be 1–20" }, 400);
          if (b.minScore !== undefined && (b.minScore < 0 || b.minScore > 1)) return json({ error: "minScore must be 0–1" }, 400);

          const start = Date.now();
          const retrieved = await retrieve(env, question, { namespace, topK, minScore: b.minScore });
          if (b.retrieveOnly) {
            return json({ candidates: retrieved.candidates, topScore: retrieved.topScore, latencyMs: Date.now() - start });
          }
          const answer = await generate(env, question, asLang(b.lang), retrieved);
          return json({ ...answer, candidates: retrieved.candidates, latencyMs: Date.now() - start });
        }

        if (path === "/api/admin/stats" && req.method === "GET") {
          const totals = await env.DB.prepare(
            "SELECT COUNT(*) AS total, COALESCE(SUM(answered),0) AS answered, ROUND(AVG(latency_ms)) AS avg_latency_ms FROM questions",
          ).first();
          const { results: unanswered } = await env.DB.prepare(
            "SELECT question, lang, created_at FROM questions WHERE answered = 0 ORDER BY id DESC LIMIT 25",
          ).all();
          return json({ totals, unanswered });
        }

        return json({ error: "Not found" }, 404);
      }

      if (path === "/api/health") return json({ ok: true });
      return json({ error: "Not found" }, 404);
    } catch (err) {
      console.error(err);
      const msg = String((err as Error)?.message ?? err);
      // Free-plan daily AI limit reached → requests fail (no billing). Tell the visitor politely.
      const status = /limit|quota|429|neuron/i.test(msg) ? 503 : 500;
      return json(
        { error: status === 503 ? `The assistant is resting for today. Please call ${env.CLINIC_PHONE}.` : "Something went wrong." },
        status,
        path === "/api/chat" ? cors(req, env) : {},
      );
    }
  },
} satisfies ExportedHandler<Env>;
