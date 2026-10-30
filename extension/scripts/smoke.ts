/**
 * Live communication smoke test: drives the REAL frontend api client against a
 * running backend, proving the request/response shapes agree with the server's
 * zod schemas. Does not call the LLM endpoints (/identify, /extract) so it spends
 * no credits. Run the server first (`npm run serve`), then: `npx tsx extension/scripts/smoke.ts`.
 */
import { api } from "../src/api/client.ts";
import type { ProductCard } from "@bestprice/shared";

const card: ProductCard = {
  brand: "Nike",
  model: "Air Force 1 '07",
  colour: "Triple White",
  styleCode: "CW2288-111",
  barcode: null,
  sizeSystem: "EU",
  category: "sneakers",
  requestedSize: "EU 43",
  searchQueries: [{ lang: "en", query: "Nike Air Force 1 '07 Triple White CW2288-111" }],
  confidence: "high",
  notes: null,
};

async function main(): Promise<void> {
  const health = await api.health();
  console.log("health:", health);

  const fx = await api.fx();
  console.log("fx: base", fx.base, "· #rates", Object.keys(fx.rates).length, "· PLN", fx.rates.PLN);

  const list = await api.search(card, { countries: ["IT", "DE"] });
  console.log(
    "search: rows", list.rows.length,
    "· searched", list.meta.countriesSearched.join(","),
    "· withPriceHint", list.meta.withPriceHint,
  );

  const ranked = await api.rank([]);
  console.log("rank([]): top5", ranked.top5.length, "· stats", JSON.stringify(ranked.stats));

  console.log("\n✅ Frontend api client and backend communicate successfully.");
}

main().catch((err) => {
  console.error("❌ smoke failed:", err);
  process.exit(1);
});
