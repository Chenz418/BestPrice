/**
 * Isolate the "zero qualified" cause: feed extractFacts() synthetic snapshots that
 * mimic what the FRONTEND page verifier captures, and print the qualification
 * verdict. This bypasses the (server-side-blocked) page fetch so we can test the
 * Extract + ranking logic alone, against the live LLM.
 */
import {
  isRankableMatch,
  missingInfo,
  type ProductCard,
  type PageSnapshot,
  type SearchCandidate,
} from "@bestprice/shared";
import { extractFacts } from "../src/verify/extract.ts";
import { fetchEurRates } from "../src/search/currency.ts";

const card: ProductCard = {
  brand: "Dr. Martens",
  model: "1461 Crazy Horse",
  colour: "Tan",
  styleCode: null,
  barcode: null,
  sizeSystem: "UK",
  category: "shoes",
  requestedSize: null,
  searchQueries: [{ lang: "en", query: "Dr. Martens 1461 Crazy Horse" }],
} as unknown as ProductCard;

const candidate: SearchCandidate = {
  shop: "example-shop.it",
  title: "Dr. Martens 1461 Crazy Horse Tan",
  url: "https://example-shop.it/dr-martens-1461-crazy-horse",
  country: "IT",
  snippet: null,
  sponsored: false,
} as unknown as SearchCandidate;

const PRODUCT_TEXT =
  "Dr. Martens 1461 Crazy Horse — Tan. The classic 3-eye shoe in Crazy Horse " +
  "leather. Price: € 169,00. Add to cart. Select your size below.";

const SIZE_SIGNALS_UK = { _sizeStockSignals: ["7 [available]", "8 [available]", "9 [unavailable]"] };

const SHIPPING_TEXT_GOOD =
  "Spedizione e consegna: spediamo in tutta Italia e in Europa. " +
  "Costo di spedizione standard in Italia: € 5,90. Spedizione gratuita per ordini superiori a € 100.";

function snap(partial: Partial<PageSnapshot>): PageSnapshot {
  return {
    candidate,
    deliveryCountry: "IT",
    requestedSize: null,
    outcome: "ok",
    pageText: PRODUCT_TEXT,
    fetchedAt: "2026-10-29T00:00:00.000Z",
    ...partial,
  } as PageSnapshot;
}

const SCENARIOS: Array<{ name: string; snapshot: PageSnapshot }> = [
  {
    name: "A. COMPLETE — UK size requested, size signals present, shipping page fetched",
    snapshot: snap({
      requestedSize: "UK 8",
      structuredData: SIZE_SIGNALS_UK,
      shippingText: SHIPPING_TEXT_GOOD,
    }),
  },
  {
    name: "B. SIZE MISMATCH — user typed 'EU 42', page lists UK sizes only (no conversion hint)",
    snapshot: snap({
      requestedSize: "EU 42",
      structuredData: SIZE_SIGNALS_UK,
      shippingText: SHIPPING_TEXT_GOOD,
    }),
  },
  {
    name: "C. NO SIZE DATA — frontend captured no size signals (JS size picker missed)",
    snapshot: snap({
      requestedSize: "UK 8",
      shippingText: SHIPPING_TEXT_GOOD,
    }),
  },
  {
    name: "D. NO SHIPPING — no shipping link found, shippingText null, product text silent on shipping",
    snapshot: snap({
      requestedSize: "UK 8",
      structuredData: SIZE_SIGNALS_UK,
      shippingText: null,
    }),
  },
];

async function main(): Promise<void> {
  const rates = await fetchEurRates();
  for (const { name, snapshot } of SCENARIOS) {
    const f = await extractFacts(snapshot, card, { rates });
    const shown = isRankableMatch(f); // appears in Top 5 / candidates (new ranking)
    const missing = missingInfo(f);
    console.log(`\n### ${name}`);
    console.log(
      `    → ${shown ? "SHOWN" : "NOT SHOWN"}` +
        (shown
          ? missing.length > 0
            ? ` (labels: ${missing.join(", ")})`
            : " (fully verified)"
          : ` (${f.outcome === "couldnt_verify" ? "page unreadable" : "not the product / no price"})`),
    );
    console.log(
      `    sameProduct=${f.sameProduct} sizeInStock=${f.sizeInStock} shipsTo=${f.shipsTo} ` +
        `priceOnPage=${f.priceConfirmedOnPage} itemEur=${f.itemPriceEur} ` +
        `shipEur=${f.shippingCostEur} freeOver=${f.freeShippingThresholdEur}`,
    );
    console.log(`    notes: ${f.notes ?? ""}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
