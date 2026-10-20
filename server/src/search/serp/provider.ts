import type { RawSerpResult } from "./types.ts";

/** Options for a single SERP call. */
export interface SerpCallOptions {
  /** Max results to request (a single call can return up to ~100). */
  num?: number;
}

/**
 * A SERP provider: given a query string and a country, return price-sorted
 * raw results (B.1). Implementations: `serpapi.ts` (live) and `mock.ts`
 * (fixtures, for offline development per the plan's "save real examples early").
 */
export type SerpProvider = (
  query: string,
  country: string,
  opts?: SerpCallOptions,
) => Promise<RawSerpResult[]>;
