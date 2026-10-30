// Evaluate the deployed assistant against eval/questions.json.
// Usage:  node eval/run-eval.mjs https://cosmodental-assistant.<subdomain>.workers.dev
// Edit questions.json to match the documents you actually uploaded (aim for ~30 questions).
import { readFileSync, writeFileSync } from "node:fs";

const base = process.argv[2];
if (!base) {
  console.error("Usage: node eval/run-eval.mjs <worker-url>");
  process.exit(1);
}
const questions = JSON.parse(readFileSync(new URL("./questions.json", import.meta.url), "utf8"));

const rows = [];
for (const item of questions) {
  const res = await fetch(new URL("/api/chat", base), {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://www.cosmodentalusa.com" },
    body: JSON.stringify({ question: item.q, lang: item.lang }),
  });
  const r = await res.json();
  const text = (r.answer ?? "").toLowerCase();
  const keywordsOk = item.expect.every((k) => text.includes(k.toLowerCase()));
  // For unanswerable questions, the correct behaviour is to refuse (fallback message).
  const correct = item.answerable ? Boolean(r.answered) && keywordsOk : !r.answered;
  rows.push({
    q: item.q,
    answerable: item.answerable,
    answered: Boolean(r.answered),
    correct,
    cited: (r.sources ?? []).length > 0,
    latencyMs: r.latencyMs ?? null,
    topScore: typeof r.topScore === "number" ? Number(r.topScore.toFixed(3)) : null,
  });
  console.log(`${correct ? "PASS" : "FAIL"}  ${item.q}\n      -> ${r.answer ?? r.error}`);
  await new Promise((s) => setTimeout(s, 7000)); // stay under the 10 questions/minute limit
}

const answerable = rows.filter((r) => r.answerable);
const unanswerable = rows.filter((r) => !r.answerable);
const summary = {
  questions: rows.length,
  accuracy: `${Math.round((100 * rows.filter((r) => r.correct).length) / rows.length)}%`,
  answeredWhenAnswerable: `${answerable.filter((r) => r.answered).length}/${answerable.length}`,
  refusedWhenUnanswerable: `${unanswerable.filter((r) => !r.answered).length}/${unanswerable.length}`,
  citationRate: `${answerable.filter((r) => r.cited).length}/${answerable.length}`,
  avgLatencyMs: Math.round(rows.reduce((s, r) => s + (r.latencyMs ?? 0), 0) / rows.length),
};
console.log("\nSUMMARY", summary);
const out = new URL(`./results-${new Date().toISOString().slice(0, 10)}.json`, import.meta.url);
writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
console.log(`Saved ${out.pathname}`);
