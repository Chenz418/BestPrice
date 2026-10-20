import type { ProductCard } from "@bestprice/shared";

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
