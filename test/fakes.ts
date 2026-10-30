/**
 * In-memory stand-ins for Cloudflare bindings so the whole pipeline can be tested
 * offline: D1 → node:sqlite, Vectorize → brute-force cosine, Workers AI → a
 * bag-of-words "embedding" and a tiny rule-based "LLM".
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { Env } from "../src/rag";

class FakeStmt {
  constructor(private db: DatabaseSync, private sql: string, private params: unknown[] = []) {}
  bind(...p: unknown[]) { return new FakeStmt(this.db, this.sql, p); }
  async all() { return { results: this.db.prepare(this.sql).all(...(this.params as any[])) }; }
  async first() { return this.db.prepare(this.sql).get(...(this.params as any[])) ?? null; }
  async run() { this.db.prepare(this.sql).run(...(this.params as any[])); return { success: true }; }
}

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(fileURLToPath(new URL("../schema.sql", import.meta.url) as any), "utf8"));
  return {
    prepare: (sql: string) => new FakeStmt(db, sql),
    batch: async (stmts: FakeStmt[]) => {
      db.exec("BEGIN");
      try { for (const s of stmts) await s.run(); db.exec("COMMIT"); }
      catch (e) { db.exec("ROLLBACK"); throw e; }
      return [];
    },
  };
}

const DIMS = 1024;
const tokens = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]{3,}/g) ?? [];
function hash(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return Math.abs(h) % DIMS; }
export function bowEmbed(text: string): number[] {
  const v = new Array(DIMS).fill(0);
  for (const w of tokens(text)) v[hash(w)] += 1;
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

export function fakeVectorize() {
  const store = new Map<string, { values: number[]; namespace?: string }>();
  return {
    store,
    upsert: async (vs: { id: string; values: number[]; namespace?: string }[]) => {
      for (const v of vs) store.set(v.id, { values: v.values, namespace: v.namespace });
      return {};
    },
    deleteByIds: async (ids: string[]) => { for (const id of ids) store.delete(id); return {}; },
    query: async (q: number[], { topK, namespace }: { topK: number; namespace?: string }) => ({
      matches: [...store]
        .filter(([, v]) => namespace === undefined || v.namespace === namespace)
        .map(([id, v]) => ({ id, score: dot(q, v.values) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK),
    }),
  };
}

export function fakeAI() {
  const calls = { embed: 0, chat: 0 };
  return {
    calls,
    run: async (_model: string, input: any) => {
      if (input.text) { calls.embed++; return { data: (input.text as string[]).map(bowEmbed) }; }
      calls.chat++;
      // "LLM": answer with the first source that shares a word with the question, else NO_ANSWER.
      const user: string = input.messages[1].content;
      const question = user.split("QUESTION:")[1] ?? "";
      const qWords = new Set(tokens(question).filter((w) => !["what", "your", "the", "are", "you", "does"].includes(w)));
      for (const m of user.matchAll(/\[(\d+)\] \(.*?\)\n([^\n]+)/g)) {
        const sentence = m[2].split(/(?<=\.)\s+/).find((s) => tokens(s).some((w) => qWords.has(w)));
        if (sentence) return { response: `${sentence} [${m[1]}]` };
      }
      return { response: "NO_ANSWER" };
    },
  };
}

export function fakeEnv(overrides: Partial<Env> = {}) {
  const env = {
    AI: fakeAI(),
    VECTORS: fakeVectorize(),
    DB: fakeD1(),
    ADMIN_TOKEN: "test-token",
    EMBED_MODEL: "@cf/baai/bge-m3",
    CHAT_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
    TOP_K: "3",
    MIN_SCORE: "0.1",
    ALLOWED_ORIGINS: "https://www.cosmodentalusa.com",
    CLINIC_PHONE: "(708) 345-6313",
    ...overrides,
  };
  return env as unknown as Env & { AI: ReturnType<typeof fakeAI>; VECTORS: ReturnType<typeof fakeVectorize> };
}
