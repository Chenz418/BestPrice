/**
 * Offline verification of the Search pipeline (no SERP key, no OpenAI key, no FX
 * network). It drives the REAL search() code (B.1–B.4) with:
 *   - the fixture SERP provider (scripts/fixtures/serp/*.json),
 *   - a mock LLM that answers both the match and normalise agents,
 *   - fixed FX rates.
 *
 * This proves the end-to-end table is built correctly: normalisation (incl. the
 * LLM price fallback), exact-match filtering, EUR conversion, cross-country
 * dedupe, and ascending-price ordering.
 *
 *   npx tsx server/scripts/verify-search-mock.ts
 */
import { ProductCardSchema } from "@bestprice/shared";
import { search } from "../src/search/search.ts";
import { mockSerpProvider } from "../src/search/serp/mock.ts";
import type { ResponsesRequest } from "../src/llm/responsesClient.ts";
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

/** A stand-in for the two LLM agents, keyed off the json_schema format name. */
const mockLLM = async (req: ResponsesRequest): Promise<string> => {
  const text = req.input
    .map((p) => (p.type === "input_text" ? p.text : ""))
    .join("\n");

  if (req.format.name === "match_verdicts") {
    const verdicts: Array<{ index: number; isMatch: boolean; reason: string }> = [];
    for (const m of text.matchAll(/^\[(\d+)\] shop: .*? \| title: (.*)$/gm)) {
      const index = Number(m[1]);
      const title = (m[2] ?? "").toLowerCase();
      // Same model (1461) AND same colourway (Crazy Horse) => exact match.
      const isMatch = title.includes("1461") && title.includes("crazy horse");
      verdicts.push({
        index,
        isMatch,
        reason: isMatch
          ? "same model 1461 in the Crazy Horse colourway"
          : "different model, colourway, or product type",
      });
    }
    return JSON.stringify({ verdicts });
  }

  if (req.format.name === "normalised_items") {
    const items: Array<{ index: number; price: number; currency: string; shop: string }> = [];
    for (const m of text.matchAll(/^\[(\d+)\] country: /gm)) {
      // The only price-less fixture is OTTO (DE) — fill it from the (mock) PDP.
      items.push({ index: Number(m[1]), price: 137.0, currency: "EUR", shop: "OTTO" });
    }
    return JSON.stringify({ items });
  }

  throw new Error(`unexpected LLM format: ${req.format.name}`);
};

const mockRates: Rates = { EUR: 1, PLN: 4.3, SEK: 11.2, CZK: 25, HUF: 395, RON: 4.97 };

const table = await search(card, {
  countries: ["IT", "DE", "PL"],
  provider: mockSerpProvider,
  createResponse: mockLLM,
  fetchRates: async () => mockRates,
  builtAt: "2026-10-20T00:00:00.000Z",
});

printTable(table);

// --- Assertions: the table is built as expected ---------------------------
const checks: Array<[string, boolean]> = [
  ["raw results collected = 13", table.meta.totalRaw === 13],
  ["exact matches = 9", table.meta.matched === 9],
  ["rows after dedupe = 7", table.meta.afterDedupe === 7 && table.rows.length === 7],
  ["cheapest is Spartoo @ €134.95", table.rows[0]?.shop === "Spartoo" && table.rows[0]?.priceEur === 134.95],
  ["ascending EUR order", table.rows.every((r, i) => i === 0 || r.priceEur >= table.rows[i - 1]!.priceEur)],
  [
    "Otto priced via LLM fallback",
    table.rows.some((r) => r.shop === "OTTO" && r.priceEur === 137),
  ],
  [
    "PLN converted (eobuwie 599 zł -> €139.30)",
    table.rows.some((r) => r.currency === "PLN" && r.priceEur === 139.3),
  ],
  [
    "cross-country dedupe (Dr. Martens seen in DE & IT)",
    table.rows.some((r) => r.shop === "Dr. Martens" && r.seenInCountries.length === 2),
  ],
  [
    "IT Zalando sponsored duplicate merged away",
    table.rows.filter((r) => r.url.includes("zalando.it")).length === 1,
  ],
];

console.log("\n=== Checks ===");
let allPass = true;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) allPass = false;
}
console.log(allPass ? "\nAll checks passed." : "\nSOME CHECKS FAILED.");
process.exitCode = allPass ? 0 : 1;
