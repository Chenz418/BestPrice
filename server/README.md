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

## Identify API (implemented — Dev 2)

`Query → ProductCard`. A vision+text LLM turns the user's input (any of: message,
product name, product code, photo) into a product card: brand, model, colour,
style code, barcode (only if visible), size system, and one search query per
language. See the shared contract in
[`shared/src/identify.ts`](../shared/src/identify.ts).

**Representative image (for the confirmation step A.2).** After the text card is
built, `representativeImage.ts` does ONE Google Shopping SERP call, scores results
by title match (brand/model/colour/style code), confirms the best few with the
exact-match agent, then **always attaches the most reliable available image**
(result **thumbnail**, never scraped from a page):

- `representativeImageUrl` / `representativeImageSource` — the best image + its shop.
- `representativeImageConfidence` — `high` (confirmed match) / `medium` (strong
  title overlap) / `low` (best by search relevance only), so the frontend can
  prompt the user to confirm.
- `representativeImageCandidates` — ranked alternatives, so the user can decline
  and "refind" instantly without another call.

Resilient: no SERP key or any error → fields stay null. The list is empty only
when no image exists at all. The interactive confirm/correct UI is Dev 1's panel.

### LLM provider

An OpenAI-compatible proxy using the **Responses API** (`wire_api = "responses"`).
Configured via env (see `.env.example`):

| Var              | Default                     | Meaning                         |
| ---------------- | --------------------------- | ------------------------------- |
| `OPENAI_API_KEY` | —                           | Required. Your proxy key.       |
| `OPENAI_BASE_URL`| `https://apiclaude.cc/v1`   | Proxy base URL.                 |
| `IDENTIFY_MODEL` | `gpt-4o`                    | Vision-capable model id.        |

The proxy is called directly over `fetch` (`POST /responses`) with a strict
`json_schema` format, and the result is re-validated with the shared zod schema.

### Layout

```
src/
  config.ts                      env + typed config
  llm/responsesClient.ts         Responses API client (fetch)
  identify/prompt.ts             system prompt + user-message builder
  identify/productCardFormat.ts  strict JSON schema for the card
  identify/identify.ts           Query -> ProductCard (validated)
  index.ts                       HTTP server: POST /identify, GET /health
scripts/test-identify.ts         CLI to try it by hand
```

### Run it

From the repo root, after `npm install` and setting `OPENAI_API_KEY`:

```bash
# One-off from the CLI (no server needed):
npm run identify -- --name "dr martens 1461 crazy horse" --size "EU 42" --country IT --lang en,de,it
npm run identify -- --name "Nike Air Force 1 '07 white" --size "EU 43" --country IT
npm run identify -- --code CW2288-111 --lang en,de,it
npm run identify -- --image ./photo.jpg --message "these sneakers"
npm run identify -- --json ./query.json      # whole Query from a file

# Pick a model for one run (overrides IDENTIFY_MODEL):
npm run identify -- --name "dr martens 1461 crazy horse" --model "gpt-5.6 luna" --lang en,de,it

# Or run the HTTP server and POST to it:
npm run serve
curl -s localhost:3000/identify -H 'content-type: application/json' \
  -d '{"productName":"Longchamp Le Pliage","deliveryCountry":"IT"}' | jq
```

**API key / config.** Put values in `.env` (copied from `.env.example`) or export
them in your shell. **The project `.env` takes precedence over shell variables**,
so a stale `OPENAI_API_KEY` left in `~/.bashrc` can't silently win over the `.env`
you just edited. If auth fails with `INVALID_API_KEY`, the key is being rejected by
the proxy — check that the value in the source you're actually using is correct.

**Offline checks (no key).** Verify the parse/validate pipeline and the
representative-image selection without the network:

```bash
npx tsx server/scripts/verify-identify-mock.ts
npm run verify:image

# End-to-end Identify -> Search from the CLI (needs keys; see Search below):
npm run pipeline -- --name "carhartt i036593_2xn_4l" --code "i036593_2xn_4l" \
  --size "4L" --country IT --model gpt-5.6-luna --countries IT,DE,FR
```

## Search API (implemented — Dev 2)

`ProductCard → CandidateTable`. Plan steps **B.1–B.4** (it deliberately stops
before B.5 "top 15", which is the next module). See the shared contract in
[`shared/src/search.ts`](../shared/src/search.ts).

1. **B.1** one price-sorted SERP call per country, in parallel.
2. **B.2** normalise each result to `{shop, title, price, currency, url, country,
   sponsored}` — a deterministic parser (price/currency/shop), with an **LLM
   fallback** only for results it can't price.
3. **B.3** keep **exact matches** only (LLM match agent), convert prices to EUR,
   and merge duplicates across countries.
4. **B.4** build a table sorted by EUR price, ascending.

### Providers & config

| Var               | Default                   | Meaning                                   |
| ----------------- | ------------------------- | ----------------------------------------- |
| `SERP_API_KEY`    | — (blank → fixture mock)  | SerpApi key (Google Shopping engine).     |
| `SEARCH_MODEL`    | `gpt-4o`                  | Model for the match / normalise agents.   |
| `SEARCH_COUNTRIES`| built-in subset           | Comma ISO2 list to search by default.     |

- **SERP:** SerpApi `google_shopping` (per-country `gl`, localised `hl`, up to 100
  results, price-low-to-high via `tbs=p_ord:p`). With no key, a **fixture mock**
  reads `scripts/fixtures/serp/<COUNTRY>.json` through the same adapter.
- **FX:** Frankfurter (free, no key, ECB EUR-based rates), cached per run.

### Layout

```
src/search/
  countries.ts            EU-27 map (lang + currency), query picker
  serp/{types,provider,serpapi,mock}.ts   provider-agnostic SERP layer
  normalize.ts            B.2 deterministic parse + LLM fallback
  match.ts                B.3 LLM exact-match filter (batched)
  currency.ts             B.3 EUR conversion (Frankfurter)
  dedupe.ts               B.3 merge duplicates across countries
  prompts.ts              match + normalise agent prompts
  search.ts               B.1–B.4 orchestration -> CandidateTable
scripts/test-search.ts        CLI to run it by hand
scripts/verify-search-mock.ts offline end-to-end check (no keys)
scripts/fixtures/serp/*.json  saved SERP responses
```

### Run it

```bash
# Offline end-to-end check (no keys needed) — builds a full table from fixtures:
npm run verify:search

# Saved fixtures + real LLM matcher (needs OPENAI_API_KEY only):
npm run search -- --brand "Dr. Martens" --model "1461" --colour "Crazy Horse" \
  --provider mock --countries IT,DE,PL

# Live SERP + LLM (needs SERP_API_KEY and OPENAI_API_KEY):
npm run search -- --json ./card.json --countries IT,DE,FR,ES,NL

# HTTP:
npm run serve
curl -s localhost:3000/search -H 'content-type: application/json' \
  -d '{"productCard": { ... }, "countries": ["IT","DE"]}' | jq
```

## Extract API + pricing/ranking (implemented — Dev 2)

Plan steps **C** (verify) and **D** (rank & show). Contracts in
[`shared/src/verify.ts`](../shared/src/verify.ts); pure ranking in
[`shared/src/ranking.ts`](../shared/src/ranking.ts).

**Boundary:** opening shop pages (C.1) and detecting CAPTCHA/login walls (C.6) is
the extension's **Page verifier (Dev 1)** — the server never opens pages (a
datacenter IP would be blocked and get the wrong locale/shipping). Dev 2 owns:

- **Extract API** (`verify/extract.ts`): `PageSnapshot → VerifiedFacts`.
  Staged & short-circuiting — if the page didn't load → `couldnt_verify` (no LLM
  spend); C.2 same-product + C.3 size + C.5 promotions in one call; **skip the C.4
  shipping call** if C.2/C.3 failed; shipping **cached per shop**. Every price is
  checked against the page text (anti-hallucination) and converted to EUR. Page
  text is treated as untrusted data (prompt-injection safe).
- **Pricing & ranking** (`shared/src/ranking.ts`, pure): guaranteed total = item +
  shipping (free-shipping threshold applied); rank by total; promotions surfaced
  separately as "possible extra savings".
- **Verify+rank loop** (`verify/verifyAndRank.ts`): walks the step-B table in
  item-price order **in batches** (B.5 re-selection), calls an **injected page
  verifier** per candidate (Dev 1 in prod; fixtures in tests), extracts facts,
  and **stops once ≥5 qualify**; otherwise pulls the next batch until the table is
  exhausted — then returns whatever qualified. Output `RankedResults`:
  `top5` + `shippingUnknown` (ships, cost unknown) + `couldntVerify` + stats.

### Config

| Var             | Default  | Meaning                                  |
| --------------- | -------- | ---------------------------------------- |
| `EXTRACT_MODEL` | `gpt-4o` | Model for the C.2–C.5 extract agents.    |

**Server-side page verifier.** `verify/pageVerifier.ts` is an HTTP implementation
of the `PageVerifier` interface so the backend can run end-to-end on its own
(fetches the page, strips text, pulls JSON-LD, flags CAPTCHA/login/blocked). In
production this is replaced by Dev 1's browser verifier; from a server IP many real
shops return CAPTCHA/blocked → reported honestly as "couldn't verify".

### HTTP

```
POST /extract   { snapshot, productCard, model? }        -> VerifiedFacts
POST /rank      { facts[], tableSize?, top? }             -> RankedResults  (pure; no key)
POST /verify    { table, deliveryCountry?, model?, ... }  -> RankedResults  (opens pages)
```

### Run it

```bash
# Offline end-to-end of the C+D loop (no keys): ranking by total, drops,
# couldn't-verify, ships-cost-unknown, early-stop, and the <5 "available" fallback.
npm run verify:rank

# Extract one saved/hand-made snapshot with the real LLM (needs OPENAI_API_KEY):
npm run extract -- --json ./snapshot.json --model gpt-5.6-luna
```

## Whole pipeline (A → B → C → D)

`npm run full` chains Identify → Search → Verify → Rank and prints the card, the
candidate table, and the final Top 5. Needs `OPENAI_API_KEY` + `SERP_API_KEY`.

```bash
npm run full -- \
  --name "Carhartt WIP Denim OG Detroit Jacket Blue Dark Used" \
  --code "i036593_2xn_4l" --image "/home/zc/BestPrice/Products/Pasted image.png" \
  --size "L" --country IT --model gpt-6.1-sol --countries eurozone
```

`--countries` accepts `eurozone` (the 20 EUR countries), `eu` (all 27), or a
comma list. Tune `--batch`, `--target`, `--concurrency` for the verify loop.
