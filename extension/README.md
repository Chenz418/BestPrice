# extension/

Everything that runs in the browser. **Owner: Dev 1.** Implements **Workflow V2**
(Google-direct); types come from `@bestprice/shared`, and every backend response is
validated against the shared zod schemas. See
[`../docs/WORKFLOW_V2.md`](../docs/WORKFLOW_V2.md),
[`../docs/API_CONTRACT.md`](../docs/API_CONTRACT.md), and the manuscript
[`../docs/bestprice-plan-v2_EN.tex`](../docs/bestprice-plan-v2_EN.tex).

## Layout

```
src/
  config.ts              base URL, batch sizes, concurrency, timeouts
  api/client.ts          typed fetch client for /identify /search /fx /extract /rank
  lib/pool.ts            bounded-concurrency helper
  verifier/
    extractInPage.ts     injected into shop pages: JSON-LD price, text, CAPTCHA
    pageVerifier.ts      side-panel proxy → background worker
    types.ts             Page Verifier contracts
  orchestrator/
    presort.ts           C.0 price pre-sort (JSON-LD peek + FX, no LLM)
    orchestrator.ts      A→B→C.0→C→D: batching, ≥5 early-stop, cancel
  background/background.ts  service worker: opens shop pages in background tabs
  ui/                    side panel (sidepanel.html / .ts / styles.css)
scripts/smoke.ts         live backend communication test (no LLM credits)
```

## The three modules (plan §6)

- **Side panel UI** (`ui/`) — input form, product-card confirmation (A.2) with
  image refind, live progress, and results (Top 5 + buckets + coverage).
- **Orchestrator** (`orchestrator/`) — runs the pipeline, owns the C.0 pre-sort,
  the cheapest-first verify loop with the ≥5 early-stop, concurrency, and cancel.
  The backend client and Page Verifier are injected, so it can run against mocks.
- **Page Verifier** (`verifier/` + `background/`) — the only code that opens shop
  pages. The side panel messages the **background service worker**, which opens the
  page in a background tab, injects `extractInPage`, builds a `PageSnapshot`, and
  closes the tab. It never opens Google pages; the backend never opens pages.

## Build & load

```bash
npm install                      # once, from the repo root
npm run build:extension          # bundles into extension/dist/
# or: npm run watch:extension
```

Then in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked**
→ select `extension/dist`. Click the BestPrice toolbar icon to open the side panel.

The backend must be running (`npm run serve`, listens on `http://localhost:3000`,
which is listed in `manifest.json` `host_permissions`).

## Verify communication with the backend

With the server running, this exercises the real `api` client end-to-end against
the key-free endpoints (`/health`, `/fx`, `/search` in mock mode, `/rank`):

```bash
npm run serve                        # terminal 1
npx tsx extension/scripts/smoke.ts   # terminal 2
```

## Frontend's job in the V2 flow

| Step | What the frontend does | Backend call |
| ---- | ---------------------- | ------------ |
| A | Collect input → show the returned `ProductCard`; user confirms/edits | `POST /identify` → `ProductCard` |
| B | Send the confirmed card; receive organic shop links (NOT price-sorted) | `POST /search` → `CandidateList` |
| **C.0** | **Price pre-sort — no LLM.** Use `priceHint` if present, else open the page and read JSON-LD `offers.price`; convert to EUR; sort ascending, unknown prices last. Cache the snapshot by URL. | `GET /fx` |
| C | For the cheapest batch (~15, 2–3 at a time), send the cached snapshot | `POST /extract` → `VerifiedFacts` |
| — | Loop: stop at ≥5 qualifiers (`countQualified` from `@bestprice/shared`), else next batch | — |
| D | Rank all accumulated facts; render Top 5 + buckets | `POST /rank` → `RankedResults` |

`POST /verify` is backend test-only — the frontend drives `/extract` → `/rank` itself.
