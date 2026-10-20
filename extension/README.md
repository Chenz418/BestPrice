# extension/

Everything that runs in the browser. **Owner: Dev 1.**

Modules (to be built):

- **Side panel UI** — input form (product name / code / photo, required size,
  delivery country), product-card confirmation, progress, results.
- **Orchestrator** — runs the A–D pipeline: concurrency, timeouts, cancel.
- **Page verifier** — opens each shop's product page in a background window,
  collects page snapshots, detects CAPTCHAs and login walls. Never opens Google pages.

Talks to the `server/` API for Identify / Search / Extract. Uses types from `shared/`.

During early development, run against a **mock server** that returns saved SERP
responses and page snapshots, so this side doesn't wait on `server/`.

> No implementation yet.
