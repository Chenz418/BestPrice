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

/** How many offers currently qualify (used by the loop's stop condition). */
export function countQualified(facts: VerifiedFacts[]): number {
  let n = 0;
  for (const f of facts) if (classifyOffer(f) === "qualified") n++;
  return n;
}

function toRankedOffer(f: VerifiedFacts): RankedOffer {
  return {
    ...f,
    guaranteedTotalEur: guaranteedTotalEur(f)!,
    possibleExtraSavings: f.promotions.map((p) =>
      p.conditions ? `${p.text} (${p.conditions})` : p.text,
    ),
  };
}

/**
 * Rank verified facts into the final result (D.3). `top` defaults to 5. Qualifying
 * offers are sorted by guaranteed total ascending; the other buckets are returned
 * as-is for the UI ("couldn't verify" and "ships, cost unknown").
 */
export function rankVerified(
  facts: VerifiedFacts[],
  opts: { tableSize: number; processed: number; top?: number },
): RankedResults {
  const qualified: RankedOffer[] = [];
  const shippingUnknown: VerifiedFacts[] = [];
  const couldntVerify: VerifiedFacts[] = [];
  let dropped = 0;

  for (const f of facts) {
    switch (classifyOffer(f)) {
      case "qualified":
        qualified.push(toRankedOffer(f));
        break;
      case "shipping_unknown":
        shippingUnknown.push(f);
        break;
      case "couldnt_verify":
        couldntVerify.push(f);
        break;
      default:
        dropped++;
    }
  }

  qualified.sort((a, b) => a.guaranteedTotalEur - b.guaranteedTotalEur);

  return {
    top5: qualified.slice(0, opts.top ?? 5),
    shippingUnknown,
    couldntVerify,
    stats: {
      tableSize: opts.tableSize,
      processed: opts.processed,
      verified: facts.filter((f) => f.outcome === "verified").length,
      qualified: qualified.length,
      dropped,
      shippingUnknown: shippingUnknown.length,
      couldntVerify: couldntVerify.length,
    },
  };
}
