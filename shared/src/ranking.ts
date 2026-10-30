import type {
  VerifiedFacts,
  RankedOffer,
  RankedResults,
} from "./verify.ts";

/**
 * Pricing & ranking — pure functions (no network, no browser), plan D.1/D.2.
 *
 * Rank by the GUARANTEED total (item + shipping, free-shipping threshold
 * applied). Promotions are shown separately as "possible extra savings" and are
 * never folded into the total, so the ranking stays honest.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Shipping actually charged in EUR, or null if it can't be determined. */
export function effectiveShippingEur(f: VerifiedFacts): number | null {
  if (f.itemPriceEur == null) return null;
  if (f.freeShippingThresholdEur != null && f.itemPriceEur >= f.freeShippingThresholdEur) {
    return 0;
  }
  return f.shippingCostEur; // number (incl. 0) or null (= unknown)
}

/** Guaranteed total = item + shipping, or null if either is unknown. */
export function guaranteedTotalEur(f: VerifiedFacts): number | null {
  const ship = effectiveShippingEur(f);
  if (f.itemPriceEur == null || ship == null) return null;
  return round2(f.itemPriceEur + ship);
}

export type OfferClass =
  | "qualified"
  | "shipping_unknown"
  | "dropped"
  | "couldnt_verify";

/** Bucket an offer per the plan's C/D rules. */
export function classifyOffer(f: VerifiedFacts): OfferClass {
  if (f.outcome === "couldnt_verify") return "couldnt_verify";
  const core =
    f.sameProduct && // C.2
    f.sizeInStock === true && // C.3
    f.shipsTo === true && // C.4
    f.priceConfirmedOnPage &&
    f.itemPriceEur != null;
  if (!core) return "dropped";
  return guaranteedTotalEur(f) == null ? "shipping_unknown" : "qualified";
}

/**
 * Is this a rankable product match — the SAME product as the card, with a price
 * confirmed on the page? Size and shipping may still be unconfirmed; those are
 * reported via `missingInfo`, not used to exclude the offer from the ranking.
 */
export function isRankableMatch(f: VerifiedFacts): boolean {
  return (
    f.outcome === "verified" &&
    f.sameProduct &&
    f.priceConfirmedOnPage &&
    f.itemPriceEur != null
  );
}

/** Short labels for what a matching offer couldn't confirm (empty = all good). */
export function missingInfo(f: VerifiedFacts): string[] {
  const out: string[] = [];
  if (f.sizeInStock === false) out.push("size out of stock");
  else if (f.sizeInStock == null) out.push("size availability unconfirmed");

  if (f.shipsTo === false) out.push("doesn't ship to your country");
  else if (f.shipsTo == null) out.push("ships-to unconfirmed");
  else if (guaranteedTotalEur(f) == null) out.push("shipping cost unknown");
  return out;
}

/** How many offers currently qualify on EVERY check (loop stop condition). */
export function countQualified(facts: VerifiedFacts[]): number {
  let n = 0;
  for (const f of facts) if (classifyOffer(f) === "qualified") n++;
  return n;
}

function toRankedOffer(f: VerifiedFacts): RankedOffer {
  const total = guaranteedTotalEur(f);
  const missing = missingInfo(f);
  return {
    ...f,
    // A confirmed item price is guaranteed by isRankableMatch, so this is a number.
    sortPriceEur: total ?? f.itemPriceEur!,
    guaranteedTotalEur: total,
    fullyVerified: missing.length === 0,
    missing,
    possibleExtraSavings: f.promotions.map((p) =>
      p.conditions ? `${p.text} (${p.conditions})` : p.text,
    ),
  };
}

/**
 * Rank verified facts into the final result (D.3). `top` defaults to 5.
 *
 * Every matching product with a confirmed price is ranked cheapest-first by its
 * guaranteed total (or item price when shipping is unknown) — partially-verified
 * offers included, each carrying `missing` labels. The Top N are split out; the
 * rest are `candidates`. Only pages we couldn't read land in `couldntVerify`.
 */
export function rankVerified(
  facts: VerifiedFacts[],
  opts: { tableSize: number; processed: number; top?: number },
): RankedResults {
  const matches = facts
    .filter(isRankableMatch)
    .map(toRankedOffer)
    .sort((a, b) => a.sortPriceEur - b.sortPriceEur);
  const couldntVerify = facts.filter((f) => f.outcome === "couldnt_verify");

  const top = opts.top ?? 5;
  return {
    top5: matches.slice(0, top),
    candidates: matches.slice(top),
    couldntVerify,
    stats: {
      tableSize: opts.tableSize,
      processed: opts.processed,
      verified: facts.filter((f) => f.outcome === "verified").length,
      matches: matches.length,
      fullyVerified: matches.filter((o) => o.fullyVerified).length,
      couldntVerify: couldntVerify.length,
    },
  };
}
