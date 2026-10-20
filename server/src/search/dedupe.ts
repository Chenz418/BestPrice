import type { Candidate } from "@bestprice/shared";

/**
 * Merge duplicates across the parallel per-country searches (B.3).
 *
 * The same offer often shows up in several countries' results (big shops rank in
 * many locales). We key primarily on the normalised shop URL (host + path, query
 * stripped) and fall back to shop+title+rounded-EUR-price. Within a group we keep
 * the cheapest EUR offer and record every country it appeared in.
 */

/** Normalise a URL to a stable identity: lowercase host+path, no query/hash. */
function urlKey(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return null;
  }
}

function dedupeKey(c: Candidate): string {
  return (
    urlKey(c.url) ??
    `${c.shop.toLowerCase()}|${c.title.toLowerCase()}|${c.priceEur.toFixed(2)}`
  );
}

/** Merge duplicate candidates; keep the cheapest and union their countries. */
export function mergeDuplicates(candidates: Candidate[]): Candidate[] {
  const groups = new Map<string, Candidate>();

  for (const c of candidates) {
    const key = dedupeKey(c);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...c, seenInCountries: [...new Set(c.seenInCountries)] });
      continue;
    }
    // Union the countries this offer was seen in.
    const countries = new Set([...existing.seenInCountries, ...c.seenInCountries]);
    // Keep the cheaper EUR price (and its original currency/country/sponsored).
    const cheaper = c.priceEur < existing.priceEur ? c : existing;
    groups.set(key, {
      ...cheaper,
      seenInCountries: [...countries].sort(),
    });
  }

  return [...groups.values()];
}
