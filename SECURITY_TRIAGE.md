# Security Findings Triage Log

Tracks every finding from GitHub code scanning (CodeQL), Dependabot, secret scanning and manual review,
with the decision and reason. Resume numbers come from the summary table.

## Summary

| Source | Critical | High | Medium | Low/Note | Fixed | Dismissed (false positive / accepted) |
|---|---|---|---|---|---|---|
| Manual review (2026-11-13) | 0 | 0 | 3 | 3 | 4 | 2 accepted, tracked in THREAT_MODEL.md |
| `npm audit` (2026-11-13) | 0 | 0 | 0 | 0 | — | — |
| Secret scan of full git history (2026-11-13) | 0 | 0 | 0 | 0 | — | 4 false positives (see below) |
| CodeQL default setup, javascript-typescript (2026-11-13) | 0 | 0 | 0 | 0 | — | — (0 open, 0 closed) |
| Dependabot vulnerability alerts, npm + pip (2026-11-13) | 0 | 0 | 0 | 0 | — | — (0 open, 0 closed, 0 auto-dismissed) |
| Dependabot malware alerts (2026-11-13) | 0 | 0 | 0 | 0 | — | — |
| GitHub secret scanning + push protection (2026-11-13) | 0 | 0 | 0 | 0 | — | — |

**Takeaway:** automated tools (SAST, SCA, secret scanning) found no issues; all 6 real findings came from
manual review and threat modeling. They are design/logic flaws (an over-broad link allowlist reachable through
prompt injection, incomplete PII redaction, a single static admin credential) that pattern-based scanners don't
detect. Both layers are kept: scanners run on every push, and the threat model is revisited on design changes.

**Scanner notes:**
- CodeQL analyzed JavaScript/TypeScript (Worker, widget, admin). Python lives only in a Jupyter notebook, which
  CodeQL does not analyze; its packages are still covered by Dependabot (`experiments/requirements.txt`).
- Dependabot preset rule "dismiss low-impact alerts for development-scoped dependencies" is enabled. Rationale:
  dev tools (wrangler, vitest, esbuild, typescript) never ship to visitors; the only runtime dependency is `unpdf`.
- Automatic Dependabot security-update PRs are off on purpose: this is a live business site, so patches are
  applied on a branch and tested before merge.

## Findings

| ID | Source | Severity | Finding | Decision | Reason / fix |
|---|---|---|---|---|---|
| M-1 | Manual | Medium | Widget turned any `*.google.com`, `*.facebook.com`, `*.instagram.com`, `*.yelp.com` URL in an LLM answer into a link. `sites.google.com` and `docs.google.com` host user content, so a poisoned document or injected answer could show a clickable phishing link under the clinic's name. | **Fixed** (`security/hardening`) | Allowlist narrowed to `cosmodentalusa.com` + `google.com/maps`. Verified: sites.google.com, docs.google.com, google.com/url, http:// and look-alike domains are rejected. |
| M-2 | Manual | Medium | Question log redaction missed slash-format dates (DOB). | **Fixed** | Added `[date]` rule after the number rule; unit test added. |
| M-3 | Manual | Medium | Single static admin token, stored in `sessionStorage`, no MFA/audit. | **Accepted for now** | Needs Cloudflare Access (config change, not code). Tracked as T5 in threat model. |
| L-1 | Manual | Low | Malformed admin JSON (`filename: 123`) threw → 500. | **Fixed** | Type checks → 400; test added. |
| L-2 | Manual | Low | Admin page had no anti-framing / nosniff / referrer headers. | **Fixed** | `public/_headers` for `/admin.html` only (no script-src, so pdf.js and inline styles can't break). |
| L-3 | Manual | Low | Per-isolate in-memory rate limit; `"unknown"` IP bucket if `cf-connecting-ip` missing. | **Accepted for now** | On Cloudflare the header is always set; real fix is platform rate limiting (T6). |
| FP-1..3 | detect-secrets | — | "Base64 High Entropy String" in `experiments/experiments.ipynb` lines 948, 1000, 1362 | **False positive** | Embedded matplotlib PNG outputs (`image/png` data), not credentials. |
| FP-4 | git history grep | — | `ADMIN_TOKEN: "test-token"` | **False positive** | Test fixture for the in-memory fake env; not a real token. |
