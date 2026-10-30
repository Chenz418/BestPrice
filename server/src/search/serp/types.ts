/**
 * Provider-agnostic SERP result. Every provider adapter maps its own response
 * into this shape so the rest of the pipeline (normalise, match, ...) never
 * depends on a specific SERP vendor.
 */
export interface RawSerpResult {
  /** Listing title. */
  title: string;
  /** Raw price string as shown, e.g. "€139,00" or "599 zł". */
  priceText: string | null;
  /** Numeric price if the provider already parsed one. */
  price: number | null;
  /** ISO 4217 currency if the provider stated one explicitly. */
  currency: string | null;
  /** Seller / shop / source name if provided. */
  shop: string | null;
  /** Destination URL (ideally the shop's own page). */
  link: string;
  /** ISO 3166-1 alpha-2 country of the SERP call this came from. */
  country: string;
  /** Whether the provider flagged this sponsored / an ad. */
  sponsored: boolean;
  /** Organic result snippet / description, if any (Google web search). */
  snippet?: string | null;
  /** Product thumbnail image URL, if the provider returned one. */
  thumbnail: string | null;
  /** Original provider object, kept for debugging / LLM fallback. */
  raw?: unknown;
}

export class SearchError extends Error {}
