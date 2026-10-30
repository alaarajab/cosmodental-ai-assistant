/**
 * Prompt design + guardrails.
 * The model may ONLY use the numbered sources. If they don't contain the answer it
 * must reply with the token NO_ANSWER, which the Worker swaps for a friendly
 * "please call the clinic" message. That makes "unanswered" measurable.
 */

export type Lang = "en" | "es";

export interface Source {
  n: number;
  title: string;
  page: number;
  text: string;
}

export const NO_ANSWER = "NO_ANSWER";

export function systemPrompt(lang: Lang, phone: string): string {
  const language = lang === "es" ? "Spanish" : "English";
  return [
    "You are the virtual assistant on the Cosmo Dental website (159 E North Ave, Northlake, IL).",
    "Rules:",
    "1. Answer ONLY with facts found in the numbered SOURCES. Never use outside knowledge.",
    `2. If the sources do not contain the answer, reply with exactly: ${NO_ANSWER}`,
    "3. Cite every fact with its source number in square brackets, e.g. [1] or [2][3].",
    "4. Do not diagnose, give personal medical advice, or recommend medication doses.",
    `   For symptoms or personal questions, tell the person to call the clinic at ${phone}; for a medical emergency, call 911.`,
    "5. The dentists are general dentists. Never call any of them a specialist.",
    "6. Never ask for or repeat personal health information.",
    "7. Keep answers short and friendly: 1–4 sentences, or a short list.",
    `8. Always reply in ${language}, even if the sources are in another language.`,
  ].join("\n");
}

export function userPrompt(question: string, sources: Source[]): string {
  const blocks = sources
    .map((s) => `[${s.n}] (${s.title}, page ${s.page})\n${s.text}`)
    .join("\n\n");
  return `SOURCES:\n${blocks}\n\nQUESTION: ${question}`;
}

export function fallbackMessage(lang: Lang, phone: string): string {
  return lang === "es"
    ? `No encontré esa información en nuestros documentos. Por favor llame a Cosmo Dental al ${phone} y con gusto le ayudamos.`
    : `I couldn't find that in our documents. Please call Cosmo Dental at ${phone} and our team will be happy to help.`;
}

/** Which source numbers did the model actually cite? */
export function citedNumbers(answer: string, max: number): number[] {
  const nums = new Set<number>();
  for (const m of answer.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= max) nums.add(n);
  }
  return [...nums].sort((a, b) => a - b);
}

export function isNoAnswer(answer: string): boolean {
  return answer.trim().length === 0 || answer.includes(NO_ANSWER);
}
