# Security Policy

This repository powers the AI assistant on the live Cosmo Dental website (cosmodentalusa.com).

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub: **Security tab → Report a vulnerability**
(private vulnerability reporting is enabled for this repository).

Please include:
- what you found and where (file, endpoint, or page)
- steps to reproduce
- the impact you expect

You can expect an acknowledgement within 3 business days and an update on the fix within 14 days.

## Scope

In scope:
- the Cloudflare Worker (`src/`), chat widget (`public/widget.js`) and admin page (`public/admin.html`, `admin-src/`)
- prompt injection that makes the assistant show harmful content, unsafe links, or another visitor's data
- authentication bypass on `/api/admin/*`

Out of scope:
- the clinic's main website, hosting, and booking systems (not part of this repository)
- denial of service by sending large volumes of traffic
- the model giving a wrong or unhelpful answer without a security impact (please report as a normal issue)

## Supported versions

Only the version currently deployed from the `main` branch is supported.

## Security practices

- Dependabot alerts, CodeQL code scanning, secret scanning and push protection are enabled.
- Fixes are made on a separate branch and tested before they are merged and deployed.
- See [THREAT_MODEL.md](THREAT_MODEL.md) for threats and mitigations, and
  [SECURITY_TRIAGE.md](SECURITY_TRIAGE.md) for how findings were handled.
- No patient records are ever uploaded to this system.
