import type { CandidateList, RankedResults } from "@bestprice/shared";

/** Pretty-print a V2 CandidateList (organic links, not price-sorted) for the CLI. */
export function printTable(list: CandidateList): void {
  const m = list.meta;
  console.log("\n=== Candidate list (B) — Google-direct, NOT price-sorted ===");
  console.log(
    `markets: ${m.countriesSearched.join(", ")} | raw: ${m.totalRaw} | ` +
      `dropped non-product: ${m.droppedNonProduct} | after dedupe: ${m.afterDedupe} | ` +
      `with price hint: ${m.withPriceHint}`,
  );
  const cov = m.coverage;
  if (cov) {
    console.log("--- search coverage ---");
    console.log(`  requested (${cov.requested.length}): ${cov.requested.join(", ")}`);
    console.log(`  searched  (${cov.searched.length}): ${cov.searched.join(", ")}`);
    if (cov.substituted.length > 0) {
      console.log(
        `  substituted: ${cov.substituted
          .map((s) => `${s.requested}→${s.searchedVia}`)
          .join(", ")}`,
      );
    }
    if (cov.unsupported.length > 0) {
      console.log(`  unsupported (not searched): ${cov.unsupported.join(", ")}`);
    }
  }
  if (list.rows.length === 0) {
    console.log("(no candidate links)");
    return;
  }
  console.log("");
  list.rows.forEach((r, i) => {
    const ad = r.sponsored ? " [sponsored]" : "";
    const hint = r.priceHint ? `~€${r.priceHint.priceEur.toFixed(2)} (hint)` : "€? (peek)";
    console.log(
      `${String(i + 1).padStart(2)}. ${hint.padStart(14)}  ` +
        `${r.shop} [${r.seenInCountries.join("/")}]${ad}`,
    );
    console.log(`    ${r.title}`);
    console.log(`    ${r.url}`);
  });
}

/** Pretty-print the final ranked results (plan D.3). */
export function printRanked(results: RankedResults): void {
  const s = results.stats;
  console.log("\n=== TOP 5 by best price (D.3) ===");
  console.log(
    `processed ${s.processed}/${s.tableSize} | verified ${s.verified} | ` +
      `matches ${s.matches} | fully-verified ${s.fullyVerified} | ` +
      `couldn't-verify ${s.couldntVerify}`,
  );
  if (results.top5.length === 0) {
    console.log("\n(no matching product with a confirmed price — see buckets below)");
  }
  const printOffer = (o: RankedResults["top5"][number], i: number): void => {
    const total = o.guaranteedTotalEur != null ? `€${o.guaranteedTotalEur.toFixed(2)}` : `€${o.sortPriceEur.toFixed(2)}+`;
    console.log(
      `\n${i + 1}. ${total}  ${o.shop} [${o.country}]` +
        `  (item €${o.itemPriceEur?.toFixed(2)}${o.shippingCostEur ? ` + ship €${o.shippingCostEur.toFixed(2)}` : o.shipsTo === true ? " + free ship" : ""})`,
    );
    console.log(`   ${o.url}`);
    console.log(`   ${o.fullyVerified ? "fully verified" : `missing: ${o.missing.join(", ")}`} | checked: ${o.checkedAt ?? "—"}`);
    if (o.possibleExtraSavings.length > 0) {
      console.log(`   possible extra savings: ${o.possibleExtraSavings.join("; ")}`);
    }
  };
  results.top5.forEach(printOffer);

  if (results.candidates.length > 0) {
    console.log(`\n--- other candidates (${results.candidates.length}) ---`);
    results.candidates.forEach(printOffer);
  }
  if (results.couldntVerify.length > 0) {
    console.log(`\n--- couldn't verify (${results.couldntVerify.length}) ---`);
    for (const f of results.couldntVerify) {
      console.log(`   ${f.shop} — ${f.couldntVerifyReason} — ${f.url}`);
    }
  }
}
