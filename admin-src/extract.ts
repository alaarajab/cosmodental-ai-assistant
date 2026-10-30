import { extractText, getDocumentProxy } from "unpdf";
import { removeRepeatedLines } from "../src/chunk";

/** Step 1 of the pipeline: PDF → one text string per page (runs in the browser). */
export async function extractPages(data: ArrayBuffer | Uint8Array): Promise<{ page: number; text: string }[]> {
  const pdf = await getDocumentProxy(data instanceof Uint8Array ? data : new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((t, i) => ({ page: i + 1, text: t }));
  return removeRepeatedLines(pages).filter((p) => p.text.trim().length > 0);
}
