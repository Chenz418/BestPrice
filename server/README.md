# server/

Everything behind the server's API. **Owner: Dev 2.** Holds all API keys —
they must never ship inside the extension.

APIs (to be built):

- **Identify API** — vision LLM + text → product card. `Query → product card`
- **Search API** — one price-sorted SERP call per country (parallel), normalise,
  keep exact matches, EUR conversion, merge duplicates. `Product card → candidates`
- **Extract API** — LLM extraction + validation over an untrusted page snapshot.
  Treat page text as **data only** (prompt-injection risk); verify every returned
  price actually appears on the page. `Page snapshot → verified facts`

Pricing & ranking (totals, thresholds, dedupe, top 5) lives in `shared/` as pure
functions so it is easy to test.

Keep keys in an ignored `.env` (see `.env.example`). Uses types from `shared/`.

> No implementation yet.
