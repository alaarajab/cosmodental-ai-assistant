import { chunkPages, DEFAULT_CHUNK, type PageText } from "./chunk";
import {
  citedNumbers,
  fallbackMessage,
  isNoAnswer,
  systemPrompt,
  userPrompt,
  type Lang,
  type Source,
} from "./prompt";
import { batches, redact } from "./util";

export interface Env {
  AI: Ai;
  VECTORS: VectorizeIndex;
  DB: D1Database;
  ADMIN_TOKEN: string;
  EMBED_MODEL: string;
  CHAT_MODEL: string;
  TOP_K: string;
  MIN_SCORE: string;
  ALLOWED_ORIGINS: string;
  CLINIC_PHONE: string;
}

/**
 * Namespaces keep experiments apart from the live assistant inside ONE Vectorize index:
 *   "live"      → what patients see
 *   "exp-..."   → experiment copies (e.g. the same PDFs chunked at 500 / 800 / 1200 chars)
 */
export const LIVE = "live";
export const isValidNamespace = (ns: string) => ns === LIVE || /^exp-[a-z0-9-]{1,40}$/.test(ns);

const EMBED_BATCH = 20; // texts per embedding call
const UPSERT_BATCH = 100; // vectors per Vectorize upsert

/* ---------- Embeddings ---------- */

export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (const group of batches(texts, EMBED_BATCH)) {
    const res = (await env.AI.run(env.EMBED_MODEL as any, { text: group })) as unknown as { data: number[][] };
    if (!res?.data || res.data.length !== group.length) throw new Error("Embedding call failed");
    out.push(...res.data);
  }
  return out;
}

/* ---------- Ingestion ---------- */

interface DocRow {
  title: string;
  namespace: string;
  chunk_max: number;
  chunk_overlap: number;
}

/**
 * Add a batch of pages (already extracted from the PDF) to a document:
 * chunk → embed → store vectors in Vectorize and text in D1.
 * Chunk settings and namespace come from the document row, so experiments can
 * index the same PDF with different settings.
 */
export async function ingestPages(env: Env, docId: string, doc: DocRow, pages: PageText[]) {
  const chunks = chunkPages(pages, { maxChars: doc.chunk_max, overlapChars: doc.chunk_overlap });
  if (!chunks.length) return 0;

  // Prefixing the title gives each chunk context ("Aftercare – Extractions: ...").
  const vectors = await embed(env, chunks.map((c) => `${doc.title}\n${c.text}`));
  const rows = chunks.map((c, i) => ({
    id: `${docId}-p${c.page}-${c.index}`,
    values: vectors[i],
    namespace: doc.namespace,
    metadata: { docId, page: c.page },
    chunk: c,
  }));

  for (const group of batches(rows, UPSERT_BATCH)) {
    await env.VECTORS.upsert(group.map(({ id, values, namespace, metadata }) => ({ id, values, namespace, metadata })));
  }

  const insert = env.DB.prepare(
    "INSERT OR REPLACE INTO chunks (id, doc_id, idx, page, text) VALUES (?, ?, ?, ?, ?)",
  );
  await env.DB.batch(rows.map((r) => insert.bind(r.id, docId, r.chunk.index, r.chunk.page, r.chunk.text)));
  await env.DB.prepare(
    "UPDATE documents SET chunk_count = (SELECT COUNT(*) FROM chunks WHERE doc_id = ?) WHERE id = ?",
  )
    .bind(docId, docId)
    .run();
  return rows.length;
}

export async function getDocument(env: Env, docId: string) {
  return env.DB.prepare("SELECT title, namespace, chunk_max, chunk_overlap FROM documents WHERE id = ?")
    .bind(docId)
    .first<DocRow>();
}

export async function deleteDocument(env: Env, docId: string) {
  const { results } = await env.DB.prepare("SELECT id FROM chunks WHERE doc_id = ?").bind(docId).all<{ id: string }>();
  const ids = results.map((r) => r.id);
  for (const group of batches(ids, 500)) await env.VECTORS.deleteByIds(group);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM chunks WHERE doc_id = ?").bind(docId),
    env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(docId),
  ]);
  return ids.length;
}

export async function deleteNamespace(env: Env, namespace: string) {
  const { results } = await env.DB.prepare("SELECT id FROM documents WHERE namespace = ?")
    .bind(namespace)
    .all<{ id: string }>();
  let removed = 0;
  for (const d of results) removed += await deleteDocument(env, d.id);
  return { documents: results.length, chunks: removed };
}

/* ---------- Retrieval ---------- */

export interface RetrieveOptions {
  namespace?: string;
  topK?: number;
  minScore?: number;
}

export interface Retrieved {
  sources: Source[]; // passed the MIN_SCORE filter (what the LLM sees)
  candidates: { title: string; page: number; score: number }[]; // all top-k, for experiments
  topScore: number;
}

export async function retrieve(env: Env, question: string, opts: RetrieveOptions = {}): Promise<Retrieved> {
  const namespace = opts.namespace ?? LIVE;
  const topK = opts.topK ?? (Number(env.TOP_K) || 5);
  const minScore = opts.minScore ?? (Number(env.MIN_SCORE) || 0);

  const [qVec] = await embed(env, [question]);
  const result = await env.VECTORS.query(qVec, { topK, namespace });
  const topScore = result.matches[0]?.score ?? 0;
  if (!result.matches.length) return { sources: [], candidates: [], topScore };

  const placeholders = result.matches.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.page, c.text, d.title FROM chunks c JOIN documents d ON d.id = c.doc_id WHERE c.id IN (${placeholders})`,
  )
    .bind(...result.matches.map((m) => m.id))
    .all<{ id: string; page: number; text: string; title: string }>();
  const byId = new Map(results.map((r) => [r.id, r]));

  const candidates: Retrieved["candidates"] = [];
  const sources: Source[] = [];
  for (const m of result.matches) {
    const row = byId.get(m.id);
    if (!row) continue;
    candidates.push({ title: row.title, page: row.page, score: m.score });
    if (m.score >= minScore) sources.push({ n: sources.length + 1, title: row.title, page: row.page, text: row.text });
  }
  return { sources, candidates, topScore };
}

/* ---------- Generation ---------- */

export interface Answer {
  answer: string;
  answered: boolean;
  sources: { n: number; title: string; page: number }[];
  topScore: number;
}

export async function generate(env: Env, question: string, lang: Lang, retrieved: Retrieved): Promise<Answer> {
  const phone = env.CLINIC_PHONE;
  const { sources, topScore } = retrieved;

  // Nothing relevant retrieved → don't even call the LLM (saves free-tier neurons).
  if (!sources.length) {
    return { answer: fallbackMessage(lang, phone), answered: false, sources: [], topScore };
  }

  const res = (await env.AI.run(env.CHAT_MODEL as any, {
    messages: [
      { role: "system", content: systemPrompt(lang, phone) },
      { role: "user", content: userPrompt(question, sources) },
    ],
    max_tokens: 350,
    temperature: 0.2,
  })) as { response?: string };

  const text = (res?.response ?? "").trim();
  if (isNoAnswer(text)) {
    return { answer: fallbackMessage(lang, phone), answered: false, sources: [], topScore };
  }

  const cited = citedNumbers(text, sources.length);
  const shown = (cited.length ? sources.filter((s) => cited.includes(s.n)) : sources.slice(0, 1)).map(
    ({ n, title, page }) => ({ n, title, page }),
  );
  return { answer: text, answered: true, sources: shown, topScore };
}

export async function answerQuestion(env: Env, question: string, lang: Lang, opts: RetrieveOptions = {}) {
  return generate(env, question, lang, await retrieve(env, question, opts));
}

export async function logQuestion(env: Env, q: string, lang: Lang, a: Answer, latencyMs: number) {
  await env.DB.prepare(
    "INSERT INTO questions (question, lang, answered, top_score, latency_ms) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(redact(q), lang, a.answered ? 1 : 0, a.topScore, latencyMs)
    .run();
}

export { DEFAULT_CHUNK };
