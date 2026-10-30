/**
 * Admin page logic (bundled to public/admin.js by `npm run build`).
 * Step 1 of the pipeline — PDF text extraction — runs here in the browser,
 * because a free-plan Worker only gets ~10 ms of CPU per request.
 */
import { extractPages } from "./extract";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const PAGES_PER_REQUEST = 5;

function token(): string {
  return ($("token") as HTMLInputElement).value.trim();
}

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token()}`, ...(init.headers ?? {}) },
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function status(msg: string, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.className = isError ? "error" : "";
}

async function upload(ev: Event) {
  ev.preventDefault();
  const file = ($("file") as HTMLInputElement).files?.[0];
  const title = ($("title") as HTMLInputElement).value.trim() || file?.name.replace(/\.pdf$/i, "") || "";
  const lang = ($("lang") as unknown as HTMLSelectElement).value;
  if (!file) return status("Choose a PDF first.", true);
  if (!confirm("Confirm: this PDF contains clinic information only — no patient names or records?")) return;

  try {
    status("Reading PDF…");
    const pages = await extractPages(await file.arrayBuffer());
    if (!pages.length) throw new Error("No text found. Scanned PDFs need OCR first.");

    const { id } = await api("/api/admin/documents", {
      method: "POST",
      body: JSON.stringify({ title, filename: file.name, lang, pages: pages.length }),
    });

    let added = 0;
    for (let i = 0; i < pages.length; i += PAGES_PER_REQUEST) {
      status(`Embedding pages ${i + 1}–${Math.min(i + PAGES_PER_REQUEST, pages.length)} of ${pages.length}…`);
      const r = await api(`/api/admin/documents/${id}/pages`, {
        method: "POST",
        body: JSON.stringify({ pages: pages.slice(i, i + PAGES_PER_REQUEST) }),
      });
      added += r.added;
    }
    status(`Done: "${title}" — ${pages.length} pages, ${added} chunks.`);
    ($("upload") as HTMLFormElement).reset();
    await refresh();
  } catch (e) {
    status(`Upload failed: ${(e as Error).message}`, true);
  }
}

async function refresh() {
  sessionStorage.setItem("cd-admin-token", token());
  try {
    const { documents } = await api("/api/admin/documents?namespace=live");
    const tbody = $("docs");
    tbody.replaceChildren(
      ...documents.map((d: any) => {
        const tr = document.createElement("tr");
        for (const v of [d.title, d.lang.toUpperCase(), d.pages, d.chunk_count, d.created_at.slice(0, 10)]) {
          const td = document.createElement("td");
          td.textContent = String(v);
          tr.append(td);
        }
        const td = document.createElement("td");
        const btn = document.createElement("button");
        btn.textContent = "Delete";
        btn.setAttribute("aria-label", `Delete ${d.title}`);
        btn.onclick = async () => {
          if (!confirm(`Delete "${d.title}"?`)) return;
          await api(`/api/admin/documents/${d.id}`, { method: "DELETE" });
          refresh();
        };
        td.append(btn);
        tr.append(td);
        return tr;
      }),
    );

    const { totals, unanswered } = await api("/api/admin/stats");
    const rate = totals.total ? Math.round((100 * totals.answered) / totals.total) : 0;
    $("stats").textContent = `${totals.total} questions · ${rate}% answered from documents · avg ${totals.avg_latency_ms ?? 0} ms`;
    $("unanswered").replaceChildren(
      ...unanswered.map((q: any) => {
        const li = document.createElement("li");
        li.textContent = `${q.question} (${q.lang}, ${q.created_at.slice(0, 10)})`;
        return li;
      }),
    );
    $("app").hidden = false;
  } catch (e) {
    status(`Could not load: ${(e as Error).message}`, true);
  }
}

($("token") as HTMLInputElement).value = sessionStorage.getItem("cd-admin-token") ?? "";
$("login").addEventListener("submit", (e) => {
  e.preventDefault();
  refresh();
});
$("upload").addEventListener("submit", upload);
if (token()) refresh();
