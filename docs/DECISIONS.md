# Decision log

Short record of settled decisions, so we don't re-argue them. Newest first.

| Date       | Decision                                                                 | Why |
| ---------- | ------------------------------------------------------------------------ | --- |
| 2026-10-20 | Verify/rank (C+D): Extract API is `PageSnapshot → VerifiedFacts` (server never opens pages — that's Dev 1's Page verifier). Rank by **guaranteed total** (item+shipping, threshold applied); promotions shown separately. Loop verifies cheapest batches, stops at ≥5 qualifiers, else outputs available. Ships-but-cost-unknown and CAPTCHA/login are separate buckets. | Opening pages from a server gets blocked / wrong locale; ranking by item price would be dishonest; batch-by-total avoids shipping reordering the Top 5; the loop is injectable so Dev 2 can test with fixtures. |
| 2026-10-20 | Identify attaches a representative image via ONE Google Shopping SERP call → score → exact-match confirm → use the result **thumbnail** (never scrape the page). **Always attaches the most reliable available image** with a `confidence` hint + ranked alternatives; null only if no image exists. | Confirmation (A.2) needs a visual; the SERP response already carries a product thumbnail, so no page opening / injection risk. Frontend lets the user decline a low-confidence image and refind from the alternatives. |
| 2026-10-20 | Search API SERP provider: **SerpApi** Google Shopping (`gl`/`hl`, ≤100 results, price sort `tbs=p_ord:p`). No key → fixture mock. | Meets the plan's SERP requirements; fixtures let Dev 2 test offline without paying per call. |
| 2026-10-20 | Currency conversion via **Frankfurter** (free, no key, ECB EUR-based rates). | EU-focused prototype; EUR is the base; no account/limits to manage. |
| 2026-10-20 | Search dedupe key = normalised shop URL (host+path), fallback shop+title+EUR; different country TLDs are distinct offers. | Same listing recurs across country searches; different national stores ship/price differently. |
| 2026-10-20 | LLM provider for Identify: OpenAI-compatible proxy (`apiclaude.cc`) via the **Responses API**, model from `IDENTIFY_MODEL` (default `gpt-4o`). | Single key for Identify/Extract; proxy deployed with `wire_api = "responses"`. Called over `fetch` to avoid SDK drift. |
| 2026-10-20 | Tooling: npm workspaces (`shared`, `server`), TS strict, run via `tsx` (no build step for the prototype). | Simplest setup that still shares the contract types across packages. |
| 2026-10-20 | Monorepo with `extension/`, `server/`, `shared/`, all TypeScript.        | Shared type definitions; server is the natural boundary between the two developers. |
| 2026-10-20 | A small server holds all API keys; the extension never ships keys.       | Keys in an extension are public. |

## Open questions (to agree before coding)

- All core contract types in `shared/` are now defined (`Query`, `ProductCard`, `Candidate`, `CandidateTable`, `PageSnapshot`, `VerifiedFacts`, `RankedResults`). Remaining: agree the exact `PageSnapshot` fields the Dev 1 Page verifier will actually populate (e.g. `structuredData` shape, whether `shippingText` is fetched eagerly).
- Getting the shop's own URL when a SERP result links to a Google product page (needs SerpApi's immersive/offers endpoint) — deferred; Verify never opens Google pages.
- Package manager + workspace tool (npm / pnpm workspaces).
- Non-code agreements: ownership of code & idea, future split, what happens if someone stops.
