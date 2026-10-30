import {
  CandidateListSchema,
  type ProductCard,
  type CandidateList,
} from "@bestprice/shared";
import { config } from "../config.ts";
import {
  DEFAULT_COUNTRIES,
  pickQueryForCountry,
  resolveSearchCoverage,
} from "./countries.ts";
import { googleProvider } from "./serp/google.ts";
import { mockSerpProvider } from "./serp/mock.ts";
import type { SerpProvider } from "./serp/provider.ts";
import { fetchEurRates, type Rates } from "./currency.ts";
import { buildCandidates, dedupeByUrl } from "./webResults.ts";

/**
 * Search API — V2, Google-direct (plan step B).
 *
 *   B.1  one plain-Google WEB search per country, in parallel (gl/hl localised)
 *   B.2  drop non-shop domains; map organic results to candidates (shop's OWN URL)
 *   B.3  attach a best-effort EUR price HINT where the SERP gave one; dedupe by URL
 *
 * It STOPS there and returns a `CandidateList` that is deliberately NOT
 * price-sorted and has no confirmed price. The frontend pre-sorts by price with
 * no LLM (C.0, JSON-LD / the hints here) and confirms each price on-page via the
 * Extract API (C.2). There is NO LLM call in Search anymore — matching moved
 * on-page, which is why this function takes no model.
 */

export interface SearchOptions {
  /** Countries to search; defaults to SEARCH_COUNTRIES or a built-in subset. */
  countries?: string[];
  /** Max organic results requested per country (web search ≈ 10/page). */
  num?: number;
  /** SERP provider; defaults to live Google-web if a key is set, else the mock. */
  provider?: SerpProvider;
  /** FX rate source override (for testing). */
  fetchRates?: () => Promise<Rates>;
  /** ISO timestamp for the list (inject for deterministic tests). */
  builtAt?: string | null;
}

export async function search(
  card: ProductCard,
  opts: SearchOptions = {},
): Promise<CandidateList> {
  const requested =
    opts.countries ??
    (config.searchCountries.length > 0 ? config.searchCountries : DEFAULT_COUNTRIES);
  // Resolve requested countries into markets Google supports, substituting a
  // nearby market for each unsupported one (B.1). `searched` is the deduped list
  // we send SERP calls for; `coverage` is reported back to the user.
  const coverage = resolveSearchCoverage(requested);
  const countries = coverage.searched;
  const provider =
    opts.provider ?? (config.hasSerpKey() ? googleProvider : mockSerpProvider);

  // B.1 — one Google WEB search per country, in parallel. A failing country -> [].
  const perCountry = await Promise.all(
    countries.map(async (country) => {
      try {
        const query = pickQueryForCountry(card, country);
        return await provider(query, country, { num: opts.num ?? 10 });
      } catch (err) {
        console.error(`[search] ${country} SERP failed:`, String(err));
        return [];
      }
    }),
  );
  const raws = perCountry.flat();

  // EUR rates for the price hints (the backend holds FX; GET /fx serves the SAME
  // rates to the frontend so its JSON-LD peek converts identically).
  const rates = await (opts.fetchRates ?? fetchEurRates)();

  // B.2 — drop non-shop domains, map to candidates with best-effort EUR hints.
  const { candidates, droppedNonProduct } = buildCandidates(raws, rates);

  // B.3 — merge the same URL seen across markets (NOT price-sorted: C.0 does that).
  const rows = dedupeByUrl(candidates);

  const list: CandidateList = {
    productCard: card,
    rows,
    meta: {
      countriesSearched: countries,
      coverage,
      totalRaw: raws.length,
      droppedNonProduct,
      afterDedupe: rows.length,
      withPriceHint: rows.filter((r) => r.priceHint).length,
      fxBase: "EUR",
      builtAt: opts.builtAt ?? new Date().toISOString(),
    },
  };

  // Validate the whole list against the shared contract before returning.
  return CandidateListSchema.parse(list);
}
