import type { ProductCard, SearchCoverage } from "@bestprice/shared";

/**
 * Per-country search configuration: which language to query in and which
 * currency prices are expected in. Used to localise each SERP call (B.1) and to
 * infer currency during normalisation (B.2).
 */
export interface CountryConfig {
  /** Primary query language (ISO 639-1). */
  lang: string;
  /** Local currency (ISO 4217). */
  currency: string;
}

/** The EU-27 market the prototype targets. */
export const EU_COUNTRIES: Record<string, CountryConfig> = {
  AT: { lang: "de", currency: "EUR" },
  BE: { lang: "nl", currency: "EUR" },
  BG: { lang: "bg", currency: "BGN" },
  HR: { lang: "hr", currency: "EUR" },
  CY: { lang: "el", currency: "EUR" },
  CZ: { lang: "cs", currency: "CZK" },
  DK: { lang: "da", currency: "DKK" },
  EE: { lang: "et", currency: "EUR" },
  FI: { lang: "fi", currency: "EUR" },
  FR: { lang: "fr", currency: "EUR" },
  DE: { lang: "de", currency: "EUR" },
  GR: { lang: "el", currency: "EUR" },
  HU: { lang: "hu", currency: "HUF" },
  IE: { lang: "en", currency: "EUR" },
  IT: { lang: "it", currency: "EUR" },
  LV: { lang: "lv", currency: "EUR" },
  LT: { lang: "lt", currency: "EUR" },
  LU: { lang: "fr", currency: "EUR" },
  MT: { lang: "en", currency: "EUR" },
  NL: { lang: "nl", currency: "EUR" },
  PL: { lang: "pl", currency: "PLN" },
  PT: { lang: "pt", currency: "EUR" },
  RO: { lang: "ro", currency: "RON" },
  SK: { lang: "sk", currency: "EUR" },
  SI: { lang: "sl", currency: "EUR" },
  ES: { lang: "es", currency: "EUR" },
  SE: { lang: "sv", currency: "SEK" },
};

/**
 * Default set of countries to search when the caller doesn't specify. A small,
 * currency-diverse subset keeps prototype SERP costs sane; expand via the
 * `countries` option or SEARCH_COUNTRIES env for the full EU-27 run.
 */
export const DEFAULT_COUNTRIES = ["IT", "DE", "FR", "ES", "NL", "PL", "SE"];

/**
 * The euro area — every EU country that uses EUR (20 as of 2023, incl. Croatia).
 * All offers are already EUR, so cross-country totals compare directly.
 */
export const EUROZONE_COUNTRIES = Object.entries(EU_COUNTRIES)
  .filter(([, c]) => c.currency === "EUR")
  .map(([code]) => code)
  .sort();

/**
 * EU-27 countries where SerpApi's Google Shopping engine actually returns
 * results. Passing a `gl` outside this set yields an empty `shopping_results`
 * with NO error — a silent miss that quietly drops that market from the search.
 *
 * This list is deliberately CONSERVATIVE: if a country is wrongly excluded here
 * we merely search a nearby proxy market (and tell the user via coverage),
 * whereas wrongly *including* one would silently return nothing. Adjust as
 * Google expands Shopping coverage. Non-EU markets (CH/NO/UK) are out of scope.
 */
export const GOOGLE_SHOPPING_COUNTRIES = new Set<string>([
  "AT", "BE", "CZ", "DK", "FR", "DE", "IE", "IT", "NL", "PL", "PT", "RO", "ES", "SE",
]);

/**
 * Replacement market for each EU country Google Shopping does NOT support.
 * Chosen by proximity: a geographically/linguistically close market in the
 * supported set (prefer same currency / shared language / a neighbour). The
 * offer keeps its real market's country code; whether it ships to the user's
 * delivery country is decided later by the Verify step, so searching a
 * neighbouring market is a safe way to still surface relevant offers.
 *
 * Every value here MUST be a member of GOOGLE_SHOPPING_COUNTRIES.
 */
export const COUNTRY_REPLACEMENTS: Record<string, string> = {
  BG: "RO", // Bulgaria   -> Romania  (neighbour)
  HR: "AT", // Croatia    -> Austria  (EUR, near via SI)
  CY: "IT", // Cyprus     -> Italy    (EUR, Mediterranean)
  EE: "SE", // Estonia    -> Sweden   (Baltic neighbour)
  FI: "SE", // Finland    -> Sweden   (Nordic neighbour, EUR item prices rare)
  GR: "IT", // Greece     -> Italy    (EUR, Mediterranean)
  HU: "AT", // Hungary    -> Austria  (neighbour)
  LV: "PL", // Latvia     -> Poland   (regional)
  LT: "PL", // Lithuania  -> Poland   (neighbour)
  LU: "BE", // Luxembourg -> Belgium  (neighbour, FR/EUR)
  MT: "IE", // Malta      -> Ireland  (English, EUR)
  SI: "AT", // Slovenia   -> Austria  (neighbour, EUR)
  SK: "CZ", // Slovakia   -> Czechia  (neighbour, mutually intelligible)
};

/** True if SerpApi's Google Shopping returns results for this country directly. */
export function isGoogleShoppingSupported(country: string): boolean {
  return GOOGLE_SHOPPING_COUNTRIES.has(country.toUpperCase());
}

/**
 * Resolve the caller's requested countries into the markets we can actually
 * query, reporting how each one was handled (B.1). Supported countries are
 * searched directly; unsupported ones are swapped for their documented
 * replacement market; any with no replacement are reported as `unsupported`.
 * The returned `searched` list is de-duplicated — two requests that map to the
 * same market only cost one SERP call.
 */
export function resolveSearchCoverage(requested: string[]): SearchCoverage {
  const seen = new Set<string>();
  const req: string[] = [];
  for (const raw of requested) {
    const c = raw.toUpperCase();
    if (!seen.has(c)) {
      seen.add(c);
      req.push(c);
    }
  }

  const direct: string[] = [];
  const substituted: SearchCoverage["substituted"] = [];
  const unsupported: string[] = [];
  const searched = new Set<string>();

  for (const c of req) {
    if (GOOGLE_SHOPPING_COUNTRIES.has(c)) {
      direct.push(c);
      searched.add(c);
      continue;
    }
    const via = COUNTRY_REPLACEMENTS[c];
    if (via && GOOGLE_SHOPPING_COUNTRIES.has(via)) {
      substituted.push({ requested: c, searchedVia: via });
      searched.add(via);
    } else {
      unsupported.push(c);
    }
  }

  return {
    requested: req,
    searched: [...searched].sort(),
    direct,
    substituted,
    unsupported,
  };
}

export function langForCountry(country: string): string {
  return EU_COUNTRIES[country.toUpperCase()]?.lang ?? "en";
}

export function currencyForCountry(country: string): string {
  return EU_COUNTRIES[country.toUpperCase()]?.currency ?? "EUR";
}

/**
 * Pick the best search query for a country: prefer a card query in that
 * country's language, then English, then the first available, and finally a
 * brand+model fallback assembled from the card.
 */
export function pickQueryForCountry(card: ProductCard, country: string): string {
  const lang = langForCountry(country);
  const byLang = card.searchQueries.find((q) => q.lang === lang);
  if (byLang) return byLang.query;

  const english = card.searchQueries.find((q) => q.lang === "en");
  if (english) return english.query;

  const first = card.searchQueries[0];
  if (first) return first.query;

  return [card.brand, card.model, card.colour].filter(Boolean).join(" ").trim();
}
