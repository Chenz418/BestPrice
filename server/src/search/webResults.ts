import type { SearchCandidate } from "@bestprice/shared";
import type { RawSerpResult } from "./serp/types.ts";
import { currencyForCountry } from "./countries.ts";
import { toEur, type Rates } from "./currency.ts";
import { urlKey } from "./dedupe.ts";

/**
 * Turn raw Google-web results into deduped `SearchCandidate`s (V2 plan B.2/B.3).
 *
 * No LLM and no price-sort here: we only drop clearly-non-shop results, attach a
 * best-effort EUR `priceHint` when the SERP gave a price, and merge the same URL
 * seen across several country searches. Ordering by price and confirming it is
 * the frontend's job (C.0) and the Extract API's (C.2).
 */

/**
 * Hosts that are never a shop's product page: search engines, social, video,
 * encyclopaedic/editorial, Q&A, and Google-owned domains. Matched as substrings
 * of the registrable host. Deliberately small and conservative — a shop wrongly
 * kept is filtered later by the on-page same-product check (C.2); the goal here
 * is only to avoid opening obvious non-product pages during the pre-sort.
 */
const NON_PRODUCT_HOSTS = [
  "google.", "bing.", "duckduckgo.", "yahoo.",
  "youtube.", "youtu.be", "vimeo.",
  "facebook.", "instagram.", "twitter.", "x.com", "tiktok.", "pinterest.", "reddit.",
  "wikipedia.", "wiktionary.", "quora.", "medium.com", "blogspot.", "wordpress.com",
  "tripadvisor.", "linkedin.",
];

/** Host of a URL without `www.`, lower-cased, or null if unparseable. */
function hostOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** True if the URL's host looks like a real shop (not an obvious non-product site). */
export function isLikelyShop(rawUrl: string): boolean {
  const host = hostOf(rawUrl);
  if (!host) return false;
  return !NON_PRODUCT_HOSTS.some((bad) => host.includes(bad));
}

/** Build a SearchCandidate from a raw result, attaching an EUR price hint if any. */
function toCandidate(raw: RawSerpResult, rates: Rates): SearchCandidate {
  const shop = raw.shop?.trim() || hostOf(raw.link) || "unknown";
  const priceEur =
    raw.price != null
      ? toEur(raw.price, raw.currency ?? currencyForCountry(raw.country), rates)
      : null;
  return {
    shop,
    title: raw.title,
    url: raw.link,
    country: raw.country,
    snippet: raw.snippet ?? null,
    sponsored: raw.sponsored,
    seenInCountries: [raw.country],
    ...(priceEur != null
      ? { priceHint: { priceEur, source: "serp" as const, confirmed: false as const } }
      : {}),
  };
}

export interface BuildCandidatesResult {
  candidates: SearchCandidate[];
  /** How many raw results were dropped by the non-product domain filter. */
  droppedNonProduct: number;
}

/**
 * Filter raw results to likely shops and map them to candidates (with EUR hints).
 * Skips results whose URL isn't a valid http(s) URL or looks like a non-shop.
 */
export function buildCandidates(raws: RawSerpResult[], rates: Rates): BuildCandidatesResult {
  const candidates: SearchCandidate[] = [];
  let droppedNonProduct = 0;
  for (const raw of raws) {
    if (!isLikelyShop(raw.link)) {
      droppedNonProduct++;
      continue;
    }
    candidates.push(toCandidate(raw, rates));
  }
  return { candidates, droppedNonProduct };
}

/**
 * Merge candidates that are the SAME listing (identical normalised URL) across
 * the parallel per-country searches. Keeps the first-seen row, unions the
 * countries it appeared in, and prefers to keep a price hint if any copy had one.
 * Different national TLDs stay distinct (they ship / price differently).
 */
export function dedupeByUrl(candidates: SearchCandidate[]): SearchCandidate[] {
  const groups = new Map<string, SearchCandidate>();
  for (const c of candidates) {
    const key = urlKey(c.url) ?? c.url.toLowerCase();
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...c, seenInCountries: [...new Set(c.seenInCountries)] });
      continue;
    }
    const countries = new Set([...existing.seenInCountries, ...c.seenInCountries]);
    groups.set(key, {
      ...existing,
      seenInCountries: [...countries].sort(),
      // Keep any available price hint (existing wins, else take the new one).
      ...(existing.priceHint ?? c.priceHint
        ? { priceHint: existing.priceHint ?? c.priceHint }
        : {}),
    });
  }
  return [...groups.values()];
}
