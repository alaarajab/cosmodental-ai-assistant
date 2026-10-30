/**
 * Chunking: split a page of text into overlapping pieces small enough to embed
 * and to fit several of them into the LLM prompt.
 *
 * Strategy (easy to explain in an interview):
 *  1. Normalize whitespace (PDF text is full of stray line breaks).
 *  2. Split into sentences so a chunk never cuts a sentence in half.
 *  3. Pack sentences into a chunk until it reaches `maxChars`.
 *  4. Start the next chunk with the last ~`overlapChars` of the previous one,
 *     so a fact that straddles a boundary is still found by either chunk.
 *  5. A single sentence longer than `maxChars` is hard-split by words.
 */

export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
  minChars?: number;
}

export interface PageText {
  page: number; // 1-based page number, used for citations
  text: string;
}

export interface Chunk {
  page: number;
  index: number; // position within the page
  text: string;
}

export const DEFAULT_CHUNK: Required<ChunkOptions> = {
  maxChars: 800,
  overlapChars: 150,
  minChars: 40,
};

export function normalize(text: string): string {
  const cleaned = text
    .normalize("NFKC") // "ﬁ" → "fi", "ﬃ" → "ffi" (some PDF readers keep ligatures)
    .replace(/\u00ad/g, "") // soft hyphens
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/(\w)-\n(\w)/g, "$1-$2") // "full-\nmouth" → "full-mouth"
    .trim();

  // PDFs break lines by layout, not meaning. Re-join a line with the next one when it
  // clearly continues the same sentence; keep breaks after headings and questions.
  const lines = cleaned.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const continues =
      prev !== undefined &&
      prev !== "" &&
      line !== "" &&
      !/[.!?:;]$/.test(prev) &&
      (/^[a-z(]/.test(line) || prev.length >= 70);
    if (continues) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Remove headers/footers: lines that appear (ignoring digits) on at least half the pages,
 * e.g. "Cosmo Dental Clinic · 708 3456313 · Page 4 of 11". Needs all pages, so it runs
 * where the whole PDF is available (browser admin page, Python notebook).
 */
export function removeRepeatedLines<T extends { text: string }>(pages: T[], minShare = 0.5): T[] {
  if (pages.length < 3) return pages;
  const key = (l: string) => l.trim().replace(/\d+/g, "#");
  const counts = new Map<string, number>();
  for (const p of pages) {
    for (const k of new Set(p.text.split("\n").map(key).filter(Boolean))) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const repeated = new Set([...counts].filter(([, n]) => n / pages.length >= minShare).map(([k]) => k));
  return pages.map((p) => ({ ...p, text: p.text.split("\n").filter((l) => !repeated.has(key(l))).join("\n") }));
}

export function splitSentences(text: string): string[] {
  // Split after sentence-ending punctuation (not after the opening Spanish ¿ ¡) and at line breaks.
  return text
    .split(/(?<=[.!?:;])\s+|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hardSplit(sentence: string, maxChars: number): string[] {
  const words = sentence.split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > maxChars) {
      out.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function chunkPage(page: PageText, opts: ChunkOptions = {}): Chunk[] {
  const { maxChars, overlapChars, minChars } = { ...DEFAULT_CHUNK, ...opts };
  const sentences = splitSentences(normalize(page.text)).flatMap((s) =>
    s.length > maxChars ? hardSplit(s, maxChars) : [s],
  );

  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;

  for (const s of sentences) {
    if (current.length && length + 1 + s.length > maxChars) {
      chunks.push(current.join(" "));
      // carry trailing sentences forward as overlap
      const overlap: string[] = [];
      let olen = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        if (olen + current[i].length > overlapChars) break;
        overlap.unshift(current[i]);
        olen += current[i].length + 1;
      }
      current = overlap;
      length = olen;
    }
    current.push(s);
    length += s.length + 1;
  }
  if (current.length) chunks.push(current.join(" "));

  return chunks
    .filter((t) => t.length >= minChars)
    .map((text, index) => ({ page: page.page, index, text }));
}

export function chunkPages(pages: PageText[], opts: ChunkOptions = {}): Chunk[] {
  return pages.flatMap((p) => chunkPage(p, opts));
}
