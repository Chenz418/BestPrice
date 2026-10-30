/**
 * Offline verification of the V2 Search pipeline (no SERP key, no FX network).
 * Drives the REAL search() code with the fixture SERP provider and fixed FX
 * rates, proving the Google-direct behaviour:
 *   - organic results mapped to the shops' OWN URLs (no Google URLs),
 *   - best-effort EUR price HINTS attached where the SERP gave a price,
 *   - cross-country de-dupe by normalised URL,
 *   - NO exact-match / LLM filtering in Search (decoys survive — that's C.2's job),
 *   - the list is NOT price-sorted (the frontend's C.0 does that).
 *
 *   npx tsx server/scripts/verify-search-mock.ts
 */
import { ProductCardSchema } from "@bestprice/shared";
import { search } from "../src/search/search.ts";
import { mockSerpProvider } from "../src/search/serp/mock.ts";
import type { Rates } from "../src/search/currency.ts";
import { printTable } from "./_printTable.ts";

const card = ProductCardSchema.parse({
  brand: "Dr. Martens",
  model: "1461",
  colour: "Crazy Horse",
  styleCode: null,
  barcode: null,
  sizeSystem: "EU",
  category: "shoes",
  requestedSize: "EU 42",
  searchQueries: [
    { lang: "en", query: "Dr. Martens 1461 Crazy Horse shoes" },
    { lang: "de", query: "Dr. Martens 1461 Crazy Horse Halbschuhe" },
    { lang: "it", query: "Dr. Martens 1461 Crazy Horse scarpe" },
    { lang: "pl", query: "Dr. Martens 1461 Crazy Horse półbuty" },
  ],
  confidence: "high",
  notes: null,
});

const mockRates: Rates = { EUR: 1, PLN: 4.3, SEK: 11.2, CZK: 25, HUF: 395, RON: 4.97 };

const list = await search(card, {
  countries: ["IT", "DE", "PL"],
  provider: mockSerpProvider,
  fetchRates: async () => mockRates,
  builtAt: "2026-10-20T00:00:00.000Z",
});

printTable(list);

const rows = list.rows;
const find = (frag: string) => rows.filter((r) => r.url.includes(frag));

// --- Assertions: the candidate list is built as expected ------------------
const checks: Array<[string, boolean]> = [
  ["markets deduped to IT/DE/PL", list.meta.countriesSearched.join(",") === "DE,IT,PL"],
  ["coverage.direct = IT/DE/PL (all supported)", (list.meta.coverage?.direct.slice().sort().join(",") ?? "") === "DE,IT,PL"],
  ["some candidates carry a SERP price hint", list.meta.withPriceHint > 0],
  [
    "EUR result with a numeric price gets a hint (Spartoo ≈ €134.95)",
    rows.some((r) => /spartoo/i.test(r.shop) && r.priceHint?.priceEur === 134.95),
  ],
  [
    "string-only price (eobuwie '599,00 zł') → no hint, falls to the peek path",
    find("eobuwie").length === 1 && find("eobuwie")[0]?.priceHint === undefined,
  ],
  ["some candidates have no hint (frontend C.0 will peek their JSON-LD)", rows.some((r) => !r.priceHint)],
  [
    "cross-country dedupe (drmartens.com seen in DE & IT)",
    find("drmartens.com").some((r) => r.seenInCountries.length === 2),
  ],
  ["zalando.it duplicate merged to one row", find("zalando.it").length === 1],
  [
    "decoys survive Search (no LLM match filter)",
    rows.some((r) => /air force|smooth|1460/i.test(r.title)),
  ],
  ["every url is a shop page, never a Google URL", rows.every((r) => !/google\./i.test(r.url))],
  ["no non-product domains dropped (fixtures are all shops)", list.meta.droppedNonProduct === 0],
];

console.log("\n=== Checks ===");
let allPass = true;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) allPass = false;
}
console.log(allPass ? "\nAll checks passed." : "\nSOME CHECKS FAILED.");
process.exitCode = allPass ? 0 : 1;
