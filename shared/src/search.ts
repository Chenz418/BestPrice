import { z } from "zod";
import { ProductCardSchema } from "./identify.ts";

/**
 * Search module contracts.
 *
 * TWO generations live here side by side:
 *
 *   V2 (current plan, Google-direct):
 *     ProductCard -> [Search API] -> CandidateList
 *   A plain Google WEB search returns the shops' OWN pages (never Google URLs).
 *   The result is a deduped list of organic candidates, NOT price-sorted and with
 *   no confirmed price — ordering by price is the frontend's no-LLM pre-sort
 *   (C.0, JSON-LD / rich-snippet), and the real price is confirmed on-page by the
 *   Extract API (C.2). See `CandidateListSchema` below.
 *
 *   V1 (legacy, Google Shopping): ProductCard -> CandidateTable (price-sorted,
 *   LLM-matched, EUR-converted). Retained for the representative-image lookup and
 *   offline comparisons; `CandidateSchema` / `CandidateTableSchema` below.
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

/**
 * One requested country that Google Shopping doesn't support, together with the
 * supported market we searched in its place (B.1). E.g. `{ requested: "HR",
 * searchedVia: "AT" }`: Croatia has no Google Shopping, so we queried Austria.
 */
export const CountrySubstitutionSchema = z.object({
  /** The ISO2 country the caller asked for. */
  requested: z.string().length(2),
  /** The supported ISO2 market actually queried on its behalf. */
  searchedVia: z.string().length(2),
});
export type CountrySubstitution = z.infer<typeof CountrySubstitutionSchema>;

/**
 * Search coverage (returned to the user): exactly which markets were queried and
 * how each requested country was handled. SerpApi's Google Shopping engine only
 * returns results for a subset of countries; passing an unsupported `gl` yields
 * an empty result with no error. We resolve each requested country up front —
 * searched directly if supported, otherwise via a documented replacement market,
 * and flagged `unsupported` only when neither is possible — so the UI can tell
 * the user "we couldn't search Malta directly, so we searched Ireland instead".
 */
export const SearchCoverageSchema = z.object({
  /** Countries the caller asked to search (deduped, upper-cased). */
  requested: z.array(z.string().length(2)),
  /** Distinct markets a SERP call was actually made for (direct + substitutes). */
  searched: z.array(z.string().length(2)),
  /** Requested countries that Google Shopping supports and were searched as-is. */
  direct: z.array(z.string().length(2)),
  /** Requested countries searched via a supported replacement market. */
  substituted: z.array(CountrySubstitutionSchema),
  /** Requested countries with no support and no replacement (not searched). */
  unsupported: z.array(z.string().length(2)),
});
export type SearchCoverage = z.infer<typeof SearchCoverageSchema>;

/** Counters describing how the table was built (useful for debugging / the UI). */
export const SearchMetaSchema = z.object({
  /** Distinct markets a SERP call was made for (after coverage resolution). */
  countriesSearched: z.array(z.string()),
  /**
   * How each requested country was covered (direct / substituted / unsupported).
   * Added after the initial contract, so optional for backward compatibility.
   */
  coverage: SearchCoverageSchema.optional(),
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

// ===========================================================================
// V2 (Google-direct) contracts — the current plan.
// ===========================================================================

/**
 * A price signal known BEFORE the on-page price is confirmed (V2 pre-sort, C.0).
 * It is always a hint: only the Extract API, reading the page, sets the trusted
 * price (`VerifiedFacts.itemPriceEur`, `priceConfirmedOnPage`).
 */
export const PriceHintSchema = z.object({
  /** Best-effort price in EUR (converted from the source's own currency). */
  priceEur: z.number().nonnegative(),
  /** Origin: a Google rich snippet (backend) or a frontend JSON-LD page peek. */
  source: z.enum(["serp", "jsonld"]),
  /** Always false here — a hint is never the confirmed price used in the total. */
  confirmed: z.literal(false),
});
export type PriceHint = z.infer<typeof PriceHintSchema>;

/**
 * One organic shop candidate from the plain-Google search (V2 plan step B).
 * Unlike the legacy `Candidate`, it carries NO confirmed price or currency —
 * price ordering is the frontend's no-LLM pre-sort (C.0). `url` is the shop's own
 * product page (never a Google URL).
 */
export const SearchCandidateSchema = z.object({
  /** Store / seller name (from the result's `source`, else its domain). */
  shop: z.string().min(1),
  /** Organic result title. */
  title: z.string().min(1),
  /** The shop's product URL (never a Google URL). */
  url: z.string().url(),
  /** ISO 3166-1 alpha-2 country of the SERP call this came from. */
  country: z.string().length(2),
  /** Organic result snippet, if any (untrusted; display/debug only). */
  snippet: z.string().nullable(),
  /** Whether the result was flagged sponsored / an ad. */
  sponsored: z.boolean(),
  /** Every country search this (deduped) link appeared in. */
  seenInCountries: z.array(z.string().length(2)).min(1),
  /** Optional SERP price hint (`source: "serp"`). Absent when the SERP gave none. */
  priceHint: PriceHintSchema.optional(),
});
export type SearchCandidate = z.infer<typeof SearchCandidateSchema>;

/** Counters describing how the V2 candidate list was built (UI / debugging). */
export const CandidateListMetaSchema = z.object({
  /** Distinct markets a SERP call was made for (after coverage resolution). */
  countriesSearched: z.array(z.string()),
  /** How each requested country was covered (direct / substituted / unsupported). */
  coverage: SearchCoverageSchema.optional(),
  /** Raw organic results returned across all markets. */
  totalRaw: z.number().int().nonnegative(),
  /** Results dropped by the non-product domain filter. */
  droppedNonProduct: z.number().int().nonnegative(),
  /** Links left after de-duplicating by normalised URL. */
  afterDedupe: z.number().int().nonnegative(),
  /** How many surviving candidates carried a usable SERP price hint. */
  withPriceHint: z.number().int().nonnegative(),
  /** Base currency of any priceHint conversion (always "EUR"). */
  fxBase: z.string(),
  /** ISO timestamp the list was built, or null if not stamped. */
  builtAt: z.string().nullable(),
});
export type CandidateListMeta = z.infer<typeof CandidateListMetaSchema>;

/**
 * The V2 Search output (plan step B): deduped organic shop links, **not**
 * price-sorted. The frontend pre-sorts by price (C.0) and verifies the cheapest
 * batch (C) via POST /extract. Replaces `CandidateTable` for the Google path.
 */
export const CandidateListSchema = z.object({
  productCard: ProductCardSchema,
  rows: z.array(SearchCandidateSchema),
  meta: CandidateListMetaSchema,
});
export type CandidateList = z.infer<typeof CandidateListSchema>;
