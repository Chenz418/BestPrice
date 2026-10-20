# shared/

Shared TypeScript definitions used by both `extension/` and `server/`.
**Owner: Both** (changed only via a pull request both approve).

Contents (to be built):

- **Contract types** — `Query`, `ProductCard`, `Candidate`, `PageSnapshot`,
  `VerifiedFacts`, ranked-result types.
- **Runtime validation** — e.g. zod schemas mirroring the types.
- **Pricing & ranking** — pure functions (no network, no browser): guaranteed
  total = item price + shipping (thresholds applied), dedupe, top 5.
- **Test fixtures** — saved SERP responses and 10–20 real shop-page snapshots.

Contract rule: add new **optional** fields rather than renaming existing ones, so
the other person's code doesn't break.

> No implementation yet.
