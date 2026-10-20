import { z } from "zod";
import { ProductCardSchema } from "./identify.ts";

/**
 * Search module contracts (plan step B).
 *
 *   ProductCard  ->  [Search API]  ->  CandidateTable
 *
 * The Search API fetches price-sorted SERP results per country (B.1), normalises
 * them (B.2), keeps only exact matches and converts to EUR and merges duplicates
 * (B.3), then builds a price-ascending table (B.4). It STOPS there: selecting the
 * top 15 (B.5) and verification (C) are separate modules that consume this table.
 *
 * Contract rule: only ever ADD optional fields — never rename or remove.
 */

/**
 * One offer after normalisation (B.2): the minimal, provider-agnostic shape with
 * exactly the fields the plan calls for.
 */
export const NormalizedCandidateSchema = z.object({
  /** Store / seller name, e.g. "Zalando". */
  shop: z.string().min(1),
  /** Listing title as shown by the shop. */
  title: z.string().min(1),
  /** Price in the listing's own currency. */
  price: z.number().nonnegative(),
  /** ISO 4217 currency code of `price`, e.g. "EUR", "PLN". */
  currency: z.string().length(3),
  /** The shop's product URL (never a Google URL). */
  url: z.string().url(),
  /** ISO 3166-1 alpha-2 country of the SERP call this came from. */
  country: z.string().length(2),
  /** Whether the result was flagged sponsored / an ad. */
  sponsored: z.boolean(),
});
export type NormalizedCandidate = z.infer<typeof NormalizedCandidateSchema>;

/**
 * A row in the final table (B.4): a matched, EUR-converted, de-duplicated offer.
 */
export const CandidateSchema = NormalizedCandidateSchema.extend({
  /** `price` converted to EUR using the fetched reference rates. */
  priceEur: z.number().nonnegative(),
  /** Every country search this (merged) offer appeared in. */
  seenInCountries: z.array(z.string().length(2)).min(1),
  /** Short reason the matcher judged this the same product (if from the LLM). */
  matchReason: z.string().nullable().optional(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

/** Counters describing how the table was built (useful for debugging / the UI). */
export const SearchMetaSchema = z.object({
  /** Countries a SERP call was made for. */
  countriesSearched: z.array(z.string()),
  /** Raw results returned by the SERP provider across all countries. */
  totalRaw: z.number().int().nonnegative(),
  /** Results that survived normalisation (B.2). */
  normalized: z.number().int().nonnegative(),
  /** Candidates the LLM kept as exact matches (B.3). */
  matched: z.number().int().nonnegative(),
  /** Rows left after merging duplicates across countries (B.3). */
  afterDedupe: z.number().int().nonnegative(),
  /** Base currency of the FX conversion (always "EUR" here). */
  fxBase: z.string(),
  /** ISO timestamp the table was built, or null if not stamped. */
  builtAt: z.string().nullable(),
});
export type SearchMeta = z.infer<typeof SearchMetaSchema>;

/**
 * The table (B.4): candidates in ascending EUR price order, plus the card that
 * was searched and build metadata. The next module selects the top 15 (B.5).
 */
export const CandidateTableSchema = z.object({
  productCard: ProductCardSchema,
  /** Always "EUR": every row's `priceEur` is comparable. */
  currency: z.literal("EUR"),
  /** Rows sorted by `priceEur`, cheapest first. */
  rows: z.array(CandidateSchema),
  meta: SearchMetaSchema,
});
export type CandidateTable = z.infer<typeof CandidateTableSchema>;
