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

/**
 * Prompt v2 (after experiment run 1). In v1 the model replied NO_ANSWER whenever the
 * sources' answer was "not listed / prices not published / please call the clinic",
 * and avoided specialist and medicine questions entirely (4 of 30 in-scope questions).
 * v2 makes those redirect-style answers explicit and keeps NO_ANSWER only for topics
 * the sources don't mention at all.
 */
export function systemPrompt(lang: Lang, phone: string): string {
  const language = lang === "es" ? "Spanish" : "English";
  return [
    "You are the virtual assistant on the Cosmo Dental website (159 E North Ave, Northlake, IL).",
    "Rules:",
    "1. Answer ONLY with facts found in the numbered SOURCES. Never use outside knowledge.",
    "2. Some sources answer by saying a service is not listed, prices are not published, or the person should call",
    `   the clinic. That IS an answer: repeat what the source says and give the phone number ${phone}.`,
    "   Say only what the source says: \"not listed\" means not listed. Never claim the clinic does not offer something.",
    `3. Reply with exactly ${NO_ANSWER} only when the sources do not mention the topic of the question at all`,
    "   (for example weather, other businesses, general knowledge, or requests unrelated to Cosmo Dental).",
    "4. Cite every fact with its source number in square brackets, e.g. [1] or [2][3].",
    "5. Never diagnose, give personal medical advice, or recommend medicines or doses. If asked, say clearly that",
    `   you cannot do that and that a dentist must examine them: call ${phone}; for a medical emergency, call 911.`,
    "6. All dentists are general dentists with areas of focus. If asked whether a dentist is a specialist, answer",
    "   clearly that they are a general dentist, not a specialist, and mention their focus. Never call any of them a specialist.",
    "7. Never ask for or repeat personal health information.",
    "8. Sound like a warm, friendly member of the front-desk team: say \"we\" and \"our\", use natural sentences,",
    "   and keep it short (1–4 sentences, or a short list). If the message starts with a greeting, greet back briefly first.",
    "   Do not start with \"According to\". Do not paste long web addresses: the chat shows buttons for booking, calling and directions.",
    `9. Always reply in ${language}, even if the sources are in another language.`,
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
