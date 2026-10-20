# BestPrice

A browser-extension + server prototype that finds the current **best total price**
for a single product, delivered to the user's country. No long-term price monitoring.

See [`docs/BestPrice_Prototype.pdf`](docs/BestPrice_Prototype.pdf) for the full plan,
and [`docs/DECISIONS.md`](docs/DECISIONS.md) for the decision log.

> **Status:** repository scaffold only. No implementation yet.

## Repository layout (monorepo)

| Folder       | Contents                                              |
| ------------ | ----------------------------------------------------- |
| `extension/` | Browser side panel, orchestrator, page verifier       |
| `server/`    | Identify / Search / Extract APIs (holds all API keys)  |
| `shared/`    | Shared TypeScript types, runtime validation, fixtures  |

The server exists because **API keys must never ship inside an extension**. It is
also the boundary between the two developers: one owns everything in the browser,
the other owns everything behind the server's API.

## Work division

| Module          | Owner            | Job                                                     | Input → output                  |
| --------------- | ---------------- | ------------------------------------------------------- | ------------------------------- |
| Shared contracts| Both             | TS types, runtime validation (zod), test fixtures       | —                               |
| Side panel UI   | Dev 1            | Input form, card confirmation, progress, results        | User input → query; results → UI|
| Orchestrator    | Dev 1            | Runs A–D, concurrency, timeouts, cancel                 | Query → ranked results          |
| Page verifier   | Dev 1            | Opens shop pages, collects snapshots, detects CAPTCHAs  | Candidate → page snapshot       |
| Identify API    | Dev 2            | Vision LLM + text → product card                        | Query → product card            |
| Search API      | Dev 2            | SERP calls, normalising, matching, EUR conversion       | Product card → candidates       |
| Extract API     | Dev 2            | LLM extraction + validation                             | Page snapshot → verified facts  |
| Pricing & rank  | Dev 2 (in shared)| Totals, thresholds, dedupe, top 5 (pure functions)      | Verified offers → top 5         |

The data objects in the last column (query, product card, candidate, page snapshot,
verified facts) are the **contracts**. Agree on them first; then each person can
build and test alone.

## Pipeline (A–D)

- **A. Identify** — LLM builds a product card; user confirms before searching.
- **B. Search** (server) — one price-sorted SERP call per country in parallel;
  normalise, keep exact matches, convert to EUR, merge duplicates, keep ~15 cheapest.
- **C. Verify** (extension) — open each shop's own page (never Google), confirm
  product, check size stock + shipping to delivery country, record promotions
  (don't apply them), trust check.
- **D. Rank & show** — rank by guaranteed total (item + shipping); show possible
  extra savings separately; display Top 5 + "couldn't verify".

## Getting started

> Tooling (package manager, TypeScript, lint/format, CI) is not set up yet.

1. Copy `.env.example` to `.env` and fill in your keys (never commit `.env`).
2. Set spending limits on your API accounts.

## Co-development rules

- **Contract first** — agree on shared types / API before coding.
- **Protected `main`** — no direct pushes; every change via a reviewed pull request (GitHub flow).
- **Small, frequent merges** — ~15-minute reviews; merge every few days.
- **Integrate from day one** — build a walking skeleton (side panel → mock server → fake top 5), then replace fakes module by module.
- **Keep secrets out of Git** — see `.gitignore` and `.env.example`; revoke any leaked key immediately.
