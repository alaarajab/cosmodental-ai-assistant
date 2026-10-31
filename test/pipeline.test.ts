import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractPages } from "../admin-src/extract";
import { chunkPage, normalize, removeRepeatedLines, splitSentences } from "../src/chunk";
import worker from "../src/index";
import { citedNumbers, isNoAnswer, systemPrompt } from "../src/prompt";
import { redact, safeEqual } from "../src/util";
import { smallTalk } from "../src/smalltalk";
import { suggestLinks } from "../src/links";
import { fakeEnv } from "./fakes";

const pdf = readFileSync(fileURLToPath(new URL("./fixtures/office-info-SAMPLE.pdf", import.meta.url) as any));

describe("chunking", () => {
  it("normalizes PDF whitespace, ligatures and broken lines", () => {
    expect(normalize("full-\nmouth  care\n\n\n\nNext")).toBe("full-mouth care\n\nNext");
    expect(normalize("the o\ufb03ce and \ufb01llings")).toBe("the office and fillings");
    // a sentence broken by the layout is re-joined; a heading and a question keep their line breaks
    const long = "Cosmo Dental Clinic is at 159 E North Ave, Northlake, IL 60164. It is a short drive from";
    expect(normalize(`1. Clinic at a glance\nWhere is it?\n${long}\nMelrose Park and Chicago.`)).toBe(
      `1. Clinic at a glance\nWhere is it?\n${long} Melrose Park and Chicago.`,
    );
  });

  it("does not split Spanish questions after the opening ¿", () => {
    expect(splitSentences("¿Dónde está la clínica? Está en Northlake.")).toEqual(["¿Dónde está la clínica?", "Está en Northlake."]);
  });

  it("removes repeated page footers", () => {
    const topics = ["Hours and location.", "Our dentists.", "Implants.", "Insurance and payment."];
    const pages = topics.map((t, i) => ({ page: i + 1, text: `${t}\nCosmo Dental · 708 3456313 · Page ${i + 1} of 4` }));
    expect(removeRepeatedLines(pages).map((p) => p.text)).toEqual(topics);
  });

  it("respects max size, keeps overlap, never splits sentences", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is about dental care.`).join(" ");
    const chunks = chunkPage({ page: 3, text }, { maxChars: 200, overlapChars: 60 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(200);
      expect(c.page).toBe(3);
      expect(c.text.endsWith(".")).toBe(true);
    }
    // overlap: the last sentence of chunk 0 starts chunk 1
    const lastOf0 = chunks[0].text.split(". ").pop()!;
    expect(chunks[1].text.startsWith(lastOf0.replace(/\.$/, ""))).toBe(true);
  });

  it("hard-splits a giant sentence", () => {
    const chunks = chunkPage({ page: 1, text: "word ".repeat(500) }, { maxChars: 300 });
    expect(chunks.every((c) => c.text.length <= 300)).toBe(true);
  });
});

describe("prompt + guardrails", () => {
  it("extracts only valid citation numbers", () => {
    expect(citedNumbers("Open Mon [1][3], see [9]", 3)).toEqual([1, 3]);
  });
  it("detects NO_ANSWER", () => {
    expect(isNoAnswer("NO_ANSWER")).toBe(true);
    expect(isNoAnswer("We open at 10 [1]")).toBe(false);
  });
  it("forbids calling dentists specialists and asks for the right language", () => {
    expect(systemPrompt("es", "x")).toMatch(/Never call any of them a specialist/);
    expect(systemPrompt("es", "x")).toMatch(/reply in Spanish/);
    // v2: redirect-style answers ("not listed, please call") must not become NO_ANSWER
    expect(systemPrompt("en", "(708) 345-6313")).toMatch(/That IS an answer/);
    expect(systemPrompt("en", "x")).toMatch(/do not mention the topic of the question at all/);
    expect(systemPrompt("en", "x")).toMatch(/Never claim the clinic does not offer something/);
  });
  it("redacts emails and phone numbers before logging", () => {
    expect(redact("I'm jane@x.com, call 708-555-1234")).toBe("I'm [email], call [number]");
  });
  it("compares tokens safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("small talk", () => {
  it("recognizes greetings, thanks, goodbyes and identity questions in English and Spanish", () => {
    expect(smallTalk("Hi!", "en")?.kind).toBe("greeting");
    expect(smallTalk("good morning cosmo dental", "en")?.kind).toBe("greeting");
    expect(smallTalk("Hello, how are you?", "en")?.kind).toBe("howareyou");
    expect(smallTalk("Thank you so much!", "en")?.kind).toBe("thanks");
    expect(smallTalk("bye 👋", "en")?.kind).toBe("bye");
    expect(smallTalk("Are you a bot?", "en")?.kind).toBe("who");
    expect(smallTalk("¡Hola!", "en")).toMatchObject({ kind: "greeting", lang: "es" }); // replies in the language written
    expect(smallTalk("Muchas gracias", "en")).toMatchObject({ kind: "thanks", lang: "es" });
    expect(smallTalk("buenos días", "es")?.answer).toMatch(/Hola/);
  });

  it("does not swallow real questions that start with a greeting", () => {
    expect(smallTalk("Hi, what are your hours on Saturday?", "en")).toBeNull();
    expect(smallTalk("Hola, ¿aceptan pacientes nuevos?", "es")).toBeNull();
    expect(smallTalk("Do you do implants?", "en")).toBeNull();
  });
});

describe("action links", () => {
  it("adds only verified clinic links, chosen by topic", () => {
    expect(suggestLinks("How can I book an appointment?", "Use the form on the Contact page.", true, "en").map((l) => l.kind)).toEqual(["book"]);
    expect(suggestLinks("Where is the clinic?", "159 E North Ave, Northlake.", true, "en")[0]).toMatchObject({ kind: "directions", url: expect.stringContaining("google.com/maps") });
    expect(suggestLinks("I have a toothache", "Call us as soon as possible.", true, "en")[0]).toMatchObject({ kind: "call", url: "tel:+17083456313" });
    expect(suggestLinks("¿Aceptan pacientes nuevos?", "Sí.", true, "es")[0]).toMatchObject({ label: "Pedir cita en línea", url: "https://www.cosmodentalusa.com/es/contact/" });
    expect(suggestLinks("What veneers do you offer?", "Porcelain veneers.", true, "en")).toEqual([]);
  });

  it("gives a Call button when the assistant could not answer", () => {
    expect(suggestLinks("weather?", "I couldn't find that.", false, "en").map((l) => l.kind)).toEqual(["call"]);
  });
});

describe("PDF extraction", () => {
  it("returns text per page", async () => {
    const pages = await extractPages(new Uint8Array(pdf));
    expect(pages.map((p) => p.page)).toEqual([1, 2]);
    expect(pages[0].text).toMatch(/Monday through Friday/);
    expect(pages[1].text).toMatch(/general dentists/);
  });
});

describe("end-to-end through the Worker", () => {
  const call = (env: any, path: string, init: RequestInit = {}) =>
    worker.fetch(new Request(`https://assistant.test${path}`, init), env);
  const admin = { authorization: "Bearer test-token", "content-type": "application/json" };

  async function setup(env = fakeEnv(), extra: Record<string, unknown> = {}) {
    const pages = await extractPages(new Uint8Array(pdf));
    const created = await call(env, "/api/admin/documents", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ title: "Office Information", filename: "office.pdf", lang: "en", pages: pages.length, ...extra }),
    });
    const { id } = (await created.json()) as { id: string };
    const res = await call(env, `/api/admin/documents/${id}/pages`, { method: "POST", headers: admin, body: JSON.stringify({ pages }) });
    expect(res.status).toBe(200);
    return { env, id, added: ((await res.json()) as any).added as number };
  }

  const ask = (env: any, question: string, lang = "en") =>
    call(env, "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://www.cosmodentalusa.com" },
      body: JSON.stringify({ question, lang }),
    });

  it("rejects admin calls without the token", async () => {
    const res = await call(fakeEnv(), "/api/admin/documents");
    expect(res.status).toBe(401);
  });

  it("ingests, answers with a citation, and logs", async () => {
    const { env, added } = await setup();
    expect(added).toBeGreaterThan(0);
    expect(env.VECTORS.store.size).toBe(added);

    const res = await ask(env, "What are your Saturday hours?");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://www.cosmodentalusa.com");
    const body = (await res.json()) as any;
    expect(body.answered).toBe(true);
    expect(body.answer).toMatch(/Saturday/);
    expect(body.sources[0]).toMatchObject({ title: "Office Information", page: 1 });

    const stats = (await (await call(env, "/api/admin/stats", { headers: admin })).json()) as any;
    expect(stats.totals.total).toBe(1);
    expect(stats.totals.answered).toBe(1);
  });

  it("falls back to the phone number when the documents don't know", async () => {
    const { env } = await setup();
    const body = (await (await ask(env, "Do you sell parking passes?", "es")).json()) as any;
    expect(body.answered).toBe(false);
    expect(body.answer).toMatch(/\(708\) 345-6313/);
    expect(body.answer).toMatch(/Por favor/);
  });

  it("skips the LLM entirely when nothing relevant is retrieved", async () => {
    const { env } = await setup();
    const before = env.AI.calls.chat;
    await ask(env, "zzzz qqqq xxxx");
    expect(env.AI.calls.chat).toBe(before);
  });

  it("deleting a document removes its vectors and chunks", async () => {
    const { env, id } = await setup();
    const res = await call(env, `/api/admin/documents/${id}`, { method: "DELETE", headers: admin });
    expect(res.status).toBe(200);
    expect(env.VECTORS.store.size).toBe(0);
  });

  it("validates input", async () => {
    const env = fakeEnv();
    expect((await ask(env, "")).status).toBe(400);
    expect((await ask(env, "x".repeat(501))).status).toBe(400);
  });

  it("keeps experiment namespaces separate from the live assistant", async () => {
    const { env } = await setup(fakeEnv(), { namespace: "exp-c300", chunkMax: 300, chunkOverlap: 50 });
    // live assistant sees nothing
    const live = (await (await ask(env, "What are your Saturday hours?")).json()) as any;
    expect(live.answered).toBe(false);
    // the experiment endpoint can query the experiment namespace
    const exp = (await (
      await call(env, "/api/admin/ask", {
        method: "POST",
        headers: admin,
        body: JSON.stringify({ question: "What are your Saturday hours?", namespace: "exp-c300", topK: 3, retrieveOnly: true }),
      })
    ).json()) as any;
    expect(exp.candidates.length).toBeGreaterThan(0);
    expect(exp.candidates[0]).toMatchObject({ title: "Office Information", page: 1 });
    expect(exp.answer).toBeUndefined(); // retrieve-only never calls the LLM
    // smaller chunks → more chunks than the default 800
    const docs = (await (await call(env, "/api/admin/documents?namespace=exp-c300", { headers: admin })).json()) as any;
    expect(docs.documents[0].chunk_max).toBe(300);
  });

  it("can answer with custom settings and delete an experiment namespace (but never live)", async () => {
    const { env } = await setup(fakeEnv(), { namespace: "exp-a" });
    const r = (await (
      await call(env, "/api/admin/ask", {
        method: "POST",
        headers: admin,
        body: JSON.stringify({ question: "What are your Saturday hours?", namespace: "exp-a", minScore: 0.05 }),
      })
    ).json()) as any;
    expect(r.answered).toBe(true);
    expect((await call(env, "/api/admin/namespaces/live", { method: "DELETE", headers: admin })).status).toBe(400);
    const del = (await (await call(env, "/api/admin/namespaces/exp-a", { method: "DELETE", headers: admin })).json()) as any;
    expect(del.documents).toBe(1);
    expect(env.VECTORS.store.size).toBe(0);
  });

  it("rejects bad experiment settings", async () => {
    const env = fakeEnv();
    const bad = (body: object) =>
      call(env, "/api/admin/documents", { method: "POST", headers: admin, body: JSON.stringify({ title: "t", filename: "f", pages: 1, ...body }) });
    expect((await bad({ namespace: "prod" })).status).toBe(400);
    expect((await bad({ chunkMax: 50 })).status).toBe(400);
    expect((await bad({ chunkMax: 400, chunkOverlap: 300 })).status).toBe(400);
  });

  it("answers greetings instantly without search or the LLM, with Book and Call buttons", async () => {
    const env = fakeEnv();
    const before = { ...env.AI.calls };
    const body = (await (await ask(env, "Hello!")).json()) as any;
    expect(body).toMatchObject({ answered: true, smallTalk: "greeting" });
    expect(body.answer).toMatch(/Welcome to Cosmo Dental/);
    expect(body.links.map((l: any) => l.kind)).toEqual(["book", "call"]);
    expect(env.AI.calls).toEqual(before);
  });

  it("returns action links with normal answers", async () => {
    const { env } = await setup();
    const body = (await (await ask(env, "Where is Cosmo Dental located?")).json()) as any;
    expect(body.answered).toBe(true);
    expect(body.links.some((l: any) => l.kind === "directions")).toBe(true);
  });
});
