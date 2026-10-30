/**
 * Offline verification of Verify + Rank (plan C + D), no keys / no network.
 *
 * Drives the REAL verifyAndRank() loop with a mock page verifier (returns
 * snapshots whose text encodes the page facts) and a mock LLM (answers the
 * product + shipping extract agents). Checks:
 *   - ranks the Top 5 by GUARANTEED TOTAL (item + shipping), not item price,
 *   - short-circuits dropped offers (not same / size out) and buckets
 *     CAPTCHA/login as "couldn't verify" and ships-but-cost-unknown separately,
 *   - stops early once ≥ target qualify (batch loop), and
 *   - returns whatever qualified when fewer than 5 exist.
 *
 *   npx tsx server/scripts/verify-rank-mock.ts
 */
import {
  ProductCardSchema,
  CandidateListSchema,
  type SearchCandidate,
  type CandidateList,
  type PageSnapshot,
} from "@bestprice/shared";
import { verifyAndRank } from "../src/verify/verifyAndRank.ts";
import type { PageVerifier } from "../src/verify/verifyAndRank.ts";
import type { ResponsesRequest } from "../src/llm/responsesClient.ts";
import type { Rates } from "../src/search/currency.ts";

const CARD = ProductCardSchema.parse({
  brand: "Dr. Martens",
  model: "1461",
  colour: "Crazy Horse",
  styleCode: null,
  barcode: null,
  sizeSystem: "EU",
  category: "shoes",
  requestedSize: "EU 42",
  searchQueries: [{ lang: "en", query: "Dr. Martens 1461 Crazy Horse" }],
  confidence: "high",
  notes: null,
});

const rates: Rates = { EUR: 1, PLN: 4.3 };

/** Page behaviour encoded per URL; the mock verifier/LLM read these tokens. */
interface Behaviour {
  outcome?: PageSnapshot["outcome"];
  page?: string; // "SAME=yes;SIZE=in;PRICE=135.00;CUR=EUR;PROMO=none"
  shipping?: string; // "SHIP=yes;COST=0;CUR=EUR;THRESH=none"
}

/**
 * A candidate with a SERP price hint (the hint = the old pre-sort price; the
 * CONFIRMED item price still comes from the mock page's PRICE token in /extract).
 */
function cand(p: {
  shop: string;
  url: string;
  priceEur: number;
  title?: string;
  country?: string;
  sponsored?: boolean;
  seenInCountries?: string[];
}): SearchCandidate {
  return {
    shop: p.shop,
    title: p.title ?? `${CARD.brand} ${CARD.model} ${CARD.colour}`,
    url: p.url,
    country: p.country ?? "IT",
    snippet: null,
    sponsored: p.sponsored ?? false,
    seenInCountries: p.seenInCountries ?? [p.country ?? "IT"],
    priceHint: { priceEur: p.priceEur, source: "serp", confirmed: false },
  };
}

function makeList(rows: SearchCandidate[]): CandidateList {
  return CandidateListSchema.parse({
    productCard: CARD,
    rows,
    meta: {
      countriesSearched: ["IT", "DE", "PL"],
      totalRaw: rows.length,
      droppedNonProduct: 0,
      afterDedupe: rows.length,
      withPriceHint: rows.filter((r) => r.priceHint).length,
      fxBase: "EUR",
      builtAt: "2026-10-20T00:00:00.000Z",
    },
  });
}

/** Build the mock verifier + LLM from a per-URL behaviour map. */
function makeDeps(behaviour: Map<string, Behaviour>) {
  const verify: PageVerifier = async (candidate, ctx) => {
    const b = behaviour.get(candidate.url) ?? {};
    return {
      candidate,
      deliveryCountry: ctx.deliveryCountry,
      requestedSize: ctx.requestedSize,
      outcome: b.outcome ?? "ok",
      pageText: b.page ?? "SAME=yes;SIZE=in;PRICE=0;CUR=EUR;PROMO=none",
      shippingText: b.shipping ?? "SHIP=yes;COST=0;CUR=EUR;THRESH=none",
      fetchedAt: "2026-10-20T00:00:00.000Z",
    };
  };

  const tok = (s: string, k: string): string | null => {
    const m = new RegExp(`${k}=([^;]+)`).exec(s);
    return m ? m[1]! : null;
  };

  const mockLLM = async (req: ResponsesRequest): Promise<string> => {
    const text = req.input.map((p) => (p.type === "input_text" ? p.text : "")).join("\n");

    if (req.format.name === "product_facts") {
      const same = tok(text, "SAME") === "yes";
      const sizeTok = tok(text, "SIZE");
      const sizeInStock = sizeTok === "in" ? true : sizeTok === "out" ? false : null;
      const priceTok = tok(text, "PRICE");
      const price = priceTok ? Number(priceTok) : null;
      const promoTok = tok(text, "PROMO");
      const promotions = promoTok && promoTok !== "none" ? [{ text: promoTok, conditions: null }] : [];
      return JSON.stringify({
        sameProduct: same,
        sizeInStock,
        pagePrice: price,
        pageCurrency: tok(text, "CUR") ?? "EUR",
        priceAppearsOnPage: price != null && price > 0,
        promotions,
        reason: same ? "same model + colourway" : "different product",
      });
    }

    if (req.format.name === "shipping_facts") {
      const shipTok = tok(text, "SHIP");
      const shipsTo = shipTok === "yes" ? true : shipTok === "no" ? false : null;
      const costTok = tok(text, "COST");
      const threshTok = tok(text, "THRESH");
      return JSON.stringify({
        shipsTo,
        shippingCost: costTok && costTok !== "unknown" ? Number(costTok) : null,
        shippingCurrency: tok(text, "CUR") ?? "EUR",
        freeShippingThreshold: threshTok && threshTok !== "none" ? Number(threshTok) : null,
        thresholdCurrency: tok(text, "CUR") ?? "EUR",
        notes: null,
      });
    }
    throw new Error(`unexpected format ${req.format.name}`);
  };

  return { verify, createResponse: mockLLM };
}

// ===========================================================================
// Scenario 1 — fewer than 5 qualify: mixed drops / couldn't-verify / unknown.
// ===========================================================================
const t1Rows = [
  cand({ shop: "Spartoo", url: "https://spartoo.it/p1", country: "IT", priceEur: 134.95 }),
  cand({ shop: "ZalandoDE", url: "https://zalando.de/p2", country: "DE", priceEur: 135.0 }),
  cand({ shop: "Otto", url: "https://otto.de/p3", country: "DE", priceEur: 137.0 }),
  cand({ shop: "ZalandoIT", url: "https://zalando.it/p4", country: "IT", priceEur: 139.0 }),
  cand({ shop: "eobuwie", url: "https://eobuwie.pl/p5", country: "PL", priceEur: 139.3 }),
  cand({ shop: "ZalandoPL", url: "https://zalando.pl/p6", country: "PL", priceEur: 143.95 }),
  cand({ shop: "DrMartens", url: "https://drmartens.com/p7", country: "DE", priceEur: 150.0, seenInCountries: ["DE", "IT"] }),
  cand({ shop: "AmazonIT", url: "https://amazon.it/p8", country: "IT", priceEur: 152.0 }),
];
const t1Behaviour = new Map<string, Behaviour>([
  ["https://spartoo.it/p1", { page: "SAME=yes;SIZE=in;PRICE=134.95;CUR=EUR;PROMO=none", shipping: "SHIP=yes;COST=6.99;CUR=EUR;THRESH=none" }],
  ["https://zalando.de/p2", { page: "SAME=yes;SIZE=in;PRICE=135.00;CUR=EUR;PROMO=none", shipping: "SHIP=yes;COST=0;CUR=EUR;THRESH=0" }],
  ["https://otto.de/p3", { page: "SAME=yes;SIZE=out;PRICE=137.00;CUR=EUR;PROMO=none" }], // size out -> dropped
  ["https://zalando.it/p4", { outcome: "captcha" }], // couldn't verify
  ["https://eobuwie.pl/p5", { page: "SAME=yes;SIZE=in;PRICE=599.00;CUR=PLN;PROMO=none", shipping: "SHIP=yes;COST=0;CUR=PLN;THRESH=300" }],
  ["https://zalando.pl/p6", { page: "SAME=no;SIZE=in;PRICE=619.00;CUR=PLN;PROMO=none" }], // not same -> dropped
  ["https://drmartens.com/p7", { page: "SAME=yes;SIZE=in;PRICE=150.00;CUR=EUR;PROMO=none", shipping: "SHIP=yes;COST=unknown;CUR=EUR;THRESH=none" }], // ships, cost unknown
  ["https://amazon.it/p8", { page: "SAME=yes;SIZE=in;PRICE=152.00;CUR=EUR;PROMO=none", shipping: "SHIP=yes;COST=0;CUR=EUR;THRESH=none" }],
]);

const r1 = await verifyAndRank(makeList(t1Rows), {
  ...makeDeps(t1Behaviour),
  deliveryCountry: "IT",
  rates,
  batchSize: 5,
  target: 5,
  checkedAt: "2026-10-20T00:00:00.000Z",
});

console.log("=== Scenario 1: matches ranked by best price (partial ones included) ===");
r1.top5.forEach((o, i) =>
  console.log(
    `${i + 1}. €${o.sortPriceEur.toFixed(2)}${o.fullyVerified ? "" : ` (${o.missing.join(", ")})`}  ${o.shop}`,
  ),
);
console.log("candidates:", r1.candidates.map((o) => o.shop));
console.log("couldntVerify:", r1.couldntVerify.map((f) => f.shop));
console.log("stats:", JSON.stringify(r1.stats));

// ===========================================================================
// Scenario 2 — plenty qualify: loop must stop early (batch of 3, target 5).
// ===========================================================================
const t2Rows = Array.from({ length: 10 }, (_, i) =>
  cand({ shop: `Shop${i}`, url: `https://shop${i}.eu/p`, country: "IT", priceEur: 100 + i }),
);
const t2Behaviour = new Map<string, Behaviour>(
  t2Rows.map((c) => [c.url, { page: `SAME=yes;SIZE=in;PRICE=${(c.priceHint?.priceEur ?? 0).toFixed(2)};CUR=EUR;PROMO=none`, shipping: "SHIP=yes;COST=0;CUR=EUR;THRESH=none" } as Behaviour]),
);
const r2 = await verifyAndRank(makeList(t2Rows), {
  ...makeDeps(t2Behaviour),
  deliveryCountry: "IT",
  rates,
  batchSize: 3,
  target: 5,
  checkedAt: "2026-10-20T00:00:00.000Z",
});

console.log("\n=== Scenario 2: early stop ===");
console.log(`top5: ${r2.top5.map((o) => o.shop).join(", ")} | processed ${r2.stats.processed}/${r2.stats.tableSize}`);

// --- Assertions -----------------------------------------------------------
const s1 = r1.top5;
const checks: Array<[string, boolean]> = [
  ["S1: 5 best-price matches in Top 5", s1.length === 5],
  ["S1: cheapest is ZalandoDE (€135 free-ship beats Spartoo €134.95+6.99)", s1[0]?.shop === "ZalandoDE"],
  ["S1: ranked ascending by sort price", s1.every((o, i) => i === 0 || o.sortPriceEur >= s1[i - 1]!.sortPriceEur)],
  ["S1: eobuwie PLN converted & free over threshold (€139.30 total)", s1.some((o) => o.shop === "eobuwie" && o.guaranteedTotalEur === 139.3)],
  ["S1: Otto shown with 'size out of stock' label (not dropped)", s1.some((o) => o.shop === "Otto" && o.missing.includes("size out of stock"))],
  ["S1: DrMartens shown with 'shipping cost unknown' label", s1.some((o) => o.shop === "DrMartens" && o.missing.includes("shipping cost unknown"))],
  ["S1: ZalandoPL (different product) excluded from matches", !s1.some((o) => o.shop === "ZalandoPL") && !r1.candidates.some((o) => o.shop === "ZalandoPL")],
  ["S1: ZalandoIT couldn't verify (captcha)", r1.couldntVerify.some((f) => f.shop === "ZalandoIT")],
  ["S1: 6 matches, 4 fully verified", r1.stats.matches === 6 && r1.stats.fullyVerified === 4],
  ["S2: exactly 5 in Top 5", r2.top5.length === 5],
  ["S2: cheapest 5 by price", r2.top5.map((o) => o.shop).join(",") === "Shop0,Shop1,Shop2,Shop3,Shop4"],
  ["S2: loop stopped early (processed < tableSize)", r2.stats.processed < r2.stats.tableSize],
];

console.log("\n=== Checks ===");
let allPass = true;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) allPass = false;
}
console.log(allPass ? "\nAll checks passed." : "\nSOME CHECKS FAILED.");
process.exitCode = allPass ? 0 : 1;
