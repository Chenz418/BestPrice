import {
  type CandidateList,
  type SearchCandidate,
  type PageSnapshot,
  type VerifiedFacts,
  type RankedResults,
  VerifiedFactsSchema,
  countQualified,
  rankVerified,
} from "@bestprice/shared";
import { LlmError } from "../llm/responsesClient.ts";
import { fetchEurRates, type Rates } from "../search/currency.ts";
import { extractFacts, type ExtractDeps } from "./extract.ts";

/**
 * Verify + rank loop (plan C + D.3). Walks the step-B table in item-price order
 * in batches; for each candidate it asks an INJECTED page verifier (Dev 1's
 * extension in production; fixtures in tests) for a snapshot, extracts facts, and
 * accumulates them. After each batch it stops once ≥ target offers qualify;
 * otherwise it pulls the next batch (B.5 re-selection) until the table is
 * exhausted. Finally it ranks qualifiers by guaranteed total and returns the Top 5
 * (or whatever qualified — "output available products" when fewer than 5).
 *
 * The server never opens pages itself; that is why `verify` is injected.
 *
 * NOTE: this is a SERVER-SIDE TEST harness. In production the frontend owns the
 * price pre-sort (C.0) and the verify loop; the backend only exposes /extract and
 * /rank. Here we approximate C.0 by ordering candidates on their SERP priceHint
 * (candidates without a hint sort last), so the cheapest-first + early-stop
 * behaviour can be exercised offline.
 */

/** Opens a shop page and returns a snapshot (Dev 1's Page verifier, C.1/C.6). */
export type PageVerifier = (
  candidate: SearchCandidate,
  ctx: { deliveryCountry: string; requestedSize: string | null },
) => Promise<PageSnapshot>;

export interface VerifyAndRankDeps extends ExtractDeps {
  /** Required: how to turn a candidate into a page snapshot. */
  verify: PageVerifier;
  /** Delivery country (ISO2); defaults to the card's or "IT". */
  deliveryCountry?: string;
  /** Requested size; defaults to the card's requestedSize. */
  requestedSize?: string | null;
  /** Cheapest-by-item-price candidates to verify per batch (plan B.5 ~15). */
  batchSize?: number;
  /** Target number of qualifying offers to stop at (Top N). */
  target?: number;
  /** How many pages to verify concurrently (plan "2–3 at a time"). */
  concurrency?: number;
}

/** Run `fn` over `items` with a bounded concurrency pool, preserving order. */
async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function verifyAndRank(
  list: CandidateList,
  deps: VerifyAndRankDeps,
): Promise<RankedResults> {
  const deliveryCountry = deps.deliveryCountry ?? "IT";
  const requestedSize = deps.requestedSize ?? list.productCard.requestedSize ?? null;
  const batchSize = deps.batchSize ?? 15;
  const target = deps.target ?? 5;
  const concurrency = deps.concurrency ?? 3;

  const rates: Rates = deps.rates ?? (await fetchEurRates());
  const shippingCache = deps.shippingCache ?? new Map();
  // Approximate the frontend's C.0 pre-sort: cheapest priceHint first, no-hint last.
  const rows = [...list.rows].sort(
    (a, b) =>
      (a.priceHint?.priceEur ?? Number.POSITIVE_INFINITY) -
      (b.priceHint?.priceEur ?? Number.POSITIVE_INFINITY),
  );
  const facts: VerifiedFacts[] = [];

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const batchFacts = await runPool(batch, concurrency, async (candidate) => {
      try {
        const snapshot = await deps.verify(candidate, { deliveryCountry, requestedSize });
        return await extractFacts(snapshot, list.productCard, {
          ...(deps.createResponse ? { createResponse: deps.createResponse } : {}),
          ...(deps.model ? { model: deps.model } : {}),
          rates,
          shippingCache,
          ...(deps.checkedAt ? { checkedAt: deps.checkedAt } : {}),
        });
      } catch (err) {
        // LLM transport/auth problems should fail loudly, not be hidden as a
        // per-page "couldn't verify".
        if (err instanceof LlmError) throw err;
        // A single page that errors degrades to "couldn't verify".
        return VerifiedFactsSchema.parse({
          url: candidate.url,
          shop: candidate.shop,
          country: candidate.country,
          outcome: "couldnt_verify",
          couldntVerifyReason: `error: ${String(err)}`,
          sameProduct: false,
          sizeInStock: null,
          shipsTo: null,
          itemPriceEur: null,
          priceConfirmedOnPage: false,
          shippingCostEur: null,
          freeShippingThresholdEur: null,
          promotions: [],
          checkedAt: deps.checkedAt ?? null,
          notes: null,
        });
      }
    });

    facts.push(...batchFacts);

    // Stop as soon as we have enough qualifying offers (D.3).
    if (countQualified(facts) >= target) break;
  }

  return rankVerified(facts, { tableSize: rows.length, processed: facts.length, top: target });
}
