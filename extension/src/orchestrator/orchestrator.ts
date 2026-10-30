import { countQualified } from "@bestprice/shared";
import type {
  CandidateList,
  CandidateListMeta,
  ProductCard,
  Query,
  RankedResults,
  SearchCandidate,
  VerifiedFacts,
} from "@bestprice/shared";
import { config } from "../config.ts";
import type { ApiClient } from "../api/client.ts";
import { runPool } from "../lib/pool.ts";
import type { PageVerifier, VerifyCtx } from "../verifier/types.ts";

/**
 * Orchestrator — runs the A→B→C.0→C→D pipeline, owning batching, the cheapest-first
 * verify loop with the ≥5 early-stop, concurrency, and cancellation. Dependencies
 * (backend client + Page Verifier) are injected so the pipeline can be driven
 * against mocks in tests.
 */

export type Progress =
  | { phase: "identify" }
  | { phase: "search" }
  | { phase: "verify"; verified: number; total: number; qualified: number }
  | { phase: "rank" }
  | { phase: "done"; qualified: number };

export interface OrchestratorDeps {
  api: ApiClient;
  verifier: PageVerifier;
}

export interface RunOpts {
  /** Delivery country (ISO2) — not stored on the card, so passed explicitly. */
  deliveryCountry: string;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
}

/**
 * A synthetic "couldn't verify" fact for a candidate whose page open or /extract
 * failed (e.g. a timeout). Per the API contract, a single failure degrades that
 * candidate — it must NOT abort the whole loop.
 */
function couldntVerifyFact(candidate: SearchCandidate, reason: string): VerifiedFacts {
  return {
    url: candidate.url,
    shop: candidate.shop,
    country: candidate.country,
    outcome: "couldnt_verify",
    couldntVerifyReason: reason,
    sameProduct: false,
    sizeInStock: null,
    shipsTo: null,
    itemPriceEur: null,
    priceConfirmedOnPage: false,
    shippingCostEur: null,
    freeShippingThresholdEur: null,
    promotions: [],
    checkedAt: null,
    notes: null,
  };
}

/** Step A: identify (the UI confirms the card before calling `searchAndRank`). */
export function identify(
  deps: OrchestratorDeps,
  query: Query,
  opts: { signal?: AbortSignal; onProgress?: (p: Progress) => void } = {},
): Promise<ProductCard> {
  opts.onProgress?.({ phase: "identify" });
  return deps.api.identify(query, { ...(opts.signal ? { signal: opts.signal } : {}) });
}

/** Pipeline result: ranked output, search metadata, and EVERY candidate's facts. */
export interface PipelineResult {
  results: RankedResults;
  listMeta: CandidateListMeta;
  /** Facts for every candidate that was verified (incl. dropped / couldn't-verify). */
  facts: VerifiedFacts[];
  /** Size of the price-sorted pool, so the UI can show "checked X of Y". */
  totalCandidates: number;
}

/**
 * Steps B → C.0 → C → D on a confirmed card. Returns the ranked Top 5 + buckets,
 * plus the search metadata so the UI can surface coverage honestly.
 */
export async function searchAndRank(
  deps: OrchestratorDeps,
  card: ProductCard,
  opts: RunOpts,
): Promise<PipelineResult> {
  const signal = opts.signal;
  const emit = opts.onProgress ?? (() => {});
  const ctx: VerifyCtx = {
    deliveryCountry: opts.deliveryCountry,
    requestedSize: card.requestedSize,
  };

  // B. Search — organic shop links, NOT price-sorted.
  emit({ phase: "search" });
  const list: CandidateList = await deps.api.search(card, {}, signal ? { signal } : {});
  assertNotAborted(signal);

  if (list.rows.length === 0) {
    const empty = await deps.api.rank([], { tableSize: 0 }, signal ? { signal } : {});
    emit({ phase: "done", qualified: 0 });
    return { results: empty, listMeta: list.meta, facts: [], totalCandidates: 0 };
  }

  // Order cheapest-first for progressive display (SERP price hint where present);
  // no page-opening pre-sort peek — every candidate is opened once in C anyway.
  const ordered = [...list.rows].sort(
    (a, b) =>
      (a.priceHint?.priceEur ?? Number.POSITIVE_INFINITY) -
      (b.priceHint?.priceEur ?? Number.POSITIVE_INFINITY),
  );

  // C. Verify — open EVERY candidate (product page + shipping page) and extract.
  // No early-stop: the user chose full coverage. Bounded only by concurrency.
  const facts: VerifiedFacts[] = [];
  for (let i = 0; i < ordered.length; i += config.batchSize) {
    assertNotAborted(signal);
    const batch = ordered.slice(i, i + config.batchSize);

    const batchFacts = await runPool(batch, config.verifyConcurrency, async (candidate) => {
      try {
        const { snapshot } = await deps.verifier.verify(candidate, ctx);
        return await deps.api.extract(snapshot, card, {}, {
          timeoutMs: config.extractTimeoutMs,
          ...(signal ? { signal } : {}),
        });
      } catch (err) {
        // User cancellation stops the run; any other failure (timeout, 502,
        // blocked page) degrades just this candidate to "couldn't verify".
        if (signal?.aborted) throw err;
        const reason = err instanceof Error ? err.message : String(err);
        return couldntVerifyFact(candidate, reason);
      }
    });

    facts.push(...batchFacts);
    emit({
      phase: "verify",
      verified: facts.length,
      total: ordered.length,
      qualified: countQualified(facts),
    });
  }

  // D. Rank — pure, by guaranteed total.
  emit({ phase: "rank" });
  const results = await deps.api.rank(
    facts,
    { tableSize: ordered.length, top: config.target },
    signal ? { signal } : {},
  );
  emit({ phase: "done", qualified: results.stats.fullyVerified });
  return { results, listMeta: list.meta, facts, totalCandidates: ordered.length };
}
