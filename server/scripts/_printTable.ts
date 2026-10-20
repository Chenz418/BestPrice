import type { CandidateTable, RankedResults } from "@bestprice/shared";

/** Pretty-print a CandidateTable for the CLI test scripts. */
export function printTable(table: CandidateTable): void {
  const m = table.meta;
  console.log("\n=== Candidate table (B.4) ===");
  console.log(
    `countries: ${m.countriesSearched.join(", ")} | raw: ${m.totalRaw} | ` +
      `normalised: ${m.normalized} | matched: ${m.matched} | ` +
      `after dedupe: ${m.afterDedupe} | currency: ${table.currency}`,
  );
  if (table.rows.length === 0) {
    console.log("(no matching offers)");
    return;
  }
  console.log("");
  table.rows.forEach((r, i) => {
    const ad = r.sponsored ? " [sponsored]" : "";
    const orig =
      r.currency === "EUR" && r.price === r.priceEur
        ? ""
        : `  (${r.price} ${r.currency})`;
    console.log(
      `${String(i + 1).padStart(2)}. €${r.priceEur.toFixed(2).padStart(8)}  ` +
        `${r.shop} [${r.seenInCountries.join("/")}]${orig}${ad}`,
    );
    console.log(`    ${r.title}`);
    console.log(`    ${r.url}`);
    if (r.matchReason) console.log(`    match: ${r.matchReason}`);
  });
}

/** Pretty-print the final ranked results (plan D.3). */
export function printRanked(results: RankedResults): void {
  const s = results.stats;
  console.log("\n=== TOP 5 by guaranteed total (D.3) ===");
  console.log(
    `processed ${s.processed}/${s.tableSize} | verified ${s.verified} | ` +
      `qualified ${s.qualified} | dropped ${s.dropped} | ` +
      `ships-unknown ${s.shippingUnknown} | couldn't-verify ${s.couldntVerify}`,
  );
  if (results.top5.length === 0) {
    console.log("\n(no fully-verified offers — see buckets below)");
  }
  results.top5.forEach((o, i) => {
    console.log(
      `\n${i + 1}. €${o.guaranteedTotalEur.toFixed(2)}  ${o.shop} [${o.country}]` +
        `  (item €${o.itemPriceEur?.toFixed(2)}${o.shippingCostEur ? ` + ship €${o.shippingCostEur.toFixed(2)}` : " + free ship"})`,
    );
    console.log(`   ${o.url}`);
    console.log(`   size in stock: yes | ships to country: yes | checked: ${o.checkedAt ?? "—"}`);
    if (o.possibleExtraSavings.length > 0) {
      console.log(`   possible extra savings: ${o.possibleExtraSavings.join("; ")}`);
    }
  });

  if (results.shippingUnknown.length > 0) {
    console.log(`\n--- ships, cost unknown (${results.shippingUnknown.length}) ---`);
    for (const f of results.shippingUnknown) {
      console.log(`   ${f.shop} — item €${f.itemPriceEur?.toFixed(2)} — ${f.url}`);
    }
  }
  if (results.couldntVerify.length > 0) {
    console.log(`\n--- couldn't verify (${results.couldntVerify.length}) ---`);
    for (const f of results.couldntVerify) {
      console.log(`   ${f.shop} — ${f.couldntVerifyReason} — ${f.url}`);
    }
  }
}
