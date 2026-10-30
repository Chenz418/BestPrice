import type { PageSnapshot, SearchCandidate, SnapshotOutcome } from "@bestprice/shared";

/** Context the Page Verifier needs to build a snapshot for a candidate. */
export interface VerifyCtx {
  deliveryCountry: string;
  requestedSize: string | null;
}

/**
 * What the in-page extractor returns from a shop page. It carries the RAW price in
 * the page's own currency (if any) — the orchestrator converts it to EUR with the
 * backend's FX rates during the C.0 pre-sort, so FX stays consistent with the
 * backend's `priceHint`.
 */
export interface InPageResult {
  outcome: SnapshotOutcome;
  pageText: string;
  jsonLd: unknown[];
  priceRaw: number | null;
  currencyRaw: string | null;
  title: string;
  /** Candidate shipping/delivery info page URLs found on the product page (C.4). */
  shippingLinks: string[];
}

/** The Page Verifier's result: a snapshot ready for /extract + the raw price peek. */
export interface VerifyPageResult {
  snapshot: PageSnapshot;
  priceRaw: number | null;
  currencyRaw: string | null;
}

/** Message the side panel sends the background service worker to open a page. */
export interface VerifyPageMessage {
  type: "VERIFY_PAGE";
  candidate: SearchCandidate;
  ctx: VerifyCtx;
}

/** Background → side panel response envelope. */
export type VerifyPageResponse =
  | { ok: true; result: VerifyPageResult }
  | { ok: false; error: string };

/** The Page Verifier contract the orchestrator depends on (injectable for tests). */
export interface PageVerifier {
  verify(candidate: SearchCandidate, ctx: VerifyCtx): Promise<VerifyPageResult>;
}
