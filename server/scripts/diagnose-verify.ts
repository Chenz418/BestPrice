/**
 * Diagnose WHY offers don't qualify. Runs Identify -> Search -> (per-candidate)
 * Verify+Extract server-side, and prints each VerifiedFacts with the exact field
 * that disqualifies it, plus an aggregate tally. Unlike /rank, it shows the
 * "dropped" offers' fields (rankVerified only counts them).
 *
 *   npx tsx server/scripts/diagnose-verify.ts --name "dr martens 1461 crazy horse" \
 *       --size "EU 42" --country IT --countries IT,DE,FR --limit 12
 */
import {
  classifyOffer,
  guaranteedTotalEur,
  type VerifiedFacts,
} from "@bestprice/shared";
import { identify } from "../src/identify/identify.ts";
import { search } from "../src/search/search.ts";
import { httpPageVerifier } from "../src/verify/pageVerifier.ts";
import { extractFacts } from "../src/verify/extract.ts";
import { fetchEurRates } from "../src/search/currency.ts";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t?.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[t.slice(2)] = "true";
      else { out[t.slice(2)] = next; i++; }
    }
  }
  return out;
}

/** The first qualification gate an offer fails (mirrors classifyOffer order). */
function firstFail(f: VerifiedFacts): string {
  if (f.outcome === "couldnt_verify") return `couldnt_verify (${f.couldntVerifyReason})`;
  if (!f.sameProduct) return "sameProduct=false (C.2)";
  if (f.sizeInStock !== true) return `sizeInStock=${f.sizeInStock} (C.3)`;
  if (f.shipsTo !== true) return `shipsTo=${f.shipsTo} (C.4)`;
  if (!f.priceConfirmedOnPage || f.itemPriceEur == null)
    return `priceConfirmedOnPage=${f.priceConfirmedOnPage}, itemPriceEur=${f.itemPriceEur}`;
  if (guaranteedTotalEur(f) == null)
    return `shipping undeterminable (cost=${f.shippingCostEur}, threshold=${f.freeShippingThresholdEur})`;
  return "QUALIFIES";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const size = args.size ?? null;
  const country = args.country ?? "IT";
  const countries = (args.countries ?? "IT,DE,FR").split(",").map((c) => c.trim().toUpperCase());
  const limit = Number(args.limit ?? "12");

  const query = {
    ...(args.name ? { productName: args.name } : {}),
    ...(args.code ? { productCode: args.code } : {}),
    ...(size ? { size } : {}),
    deliveryCountry: country,
  };

  console.log("→ Identify…");
  const card = await identify(query);
  console.log(`  card: ${card.brand} / ${card.model} / ${card.colour} / code=${card.styleCode}`);

  console.log(`→ Search ${countries.join(",")}…`);
  const list = await search(card, { countries, ...(args.num ? { num: Number(args.num) } : {}) });
  console.log(`  ${list.rows.length} candidates; ${list.meta.withPriceHint} with price hints`);

  const ordered = [...list.rows].sort(
    (a, b) => (a.priceHint?.priceEur ?? Infinity) - (b.priceHint?.priceEur ?? Infinity),
  ).slice(0, limit);
  console.log(`→ Verify + Extract the cheapest ${ordered.length} (server-side fetch)…\n`);

  const rates = await fetchEurRates();
  const shippingCache = new Map();
  const tally: Record<string, number> = {};

  for (const candidate of ordered) {
    const snapshot = await httpPageVerifier(candidate, { deliveryCountry: country, requestedSize: size });
    const facts = await extractFacts(snapshot, card, { rates, shippingCache });
    const reason = firstFail(facts);
    const bucket = classifyOffer(facts);
    tally[bucket] = (tally[bucket] ?? 0) + 1;
    console.log(
      `• ${candidate.shop} (${candidate.country}) [snap:${snapshot.outcome}] → ${bucket}\n` +
        `    same=${facts.sameProduct} size=${facts.sizeInStock} ships=${facts.shipsTo} ` +
        `priceOnPage=${facts.priceConfirmedOnPage} itemEur=${facts.itemPriceEur} ` +
        `shipEur=${facts.shippingCostEur} freeOver=${facts.freeShippingThresholdEur}\n` +
        `    WHY: ${reason}\n    note: ${facts.notes ?? ""}`,
    );
  }

  console.log("\n=== tally ===");
  for (const [k, v] of Object.entries(tally)) console.log(`  ${k}: ${v}`);
}

main().catch((err) => {
  console.error("diagnose failed:", err);
  process.exit(1);
});
