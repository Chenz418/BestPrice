import {
  CandidateTableSchema,
  type ProductCard,
  type Candidate,
  type CandidateTable,
} from "@bestprice/shared";
import { config } from "../config.ts";
import type { CreateResponseFn } from "../llm/structured.ts";
import { DEFAULT_COUNTRIES, pickQueryForCountry } from "./countries.ts";
import { serpApiProvider } from "./serp/serpapi.ts";
import { mockSerpProvider } from "./serp/mock.ts";
import type { SerpProvider } from "./serp/provider.ts";
import { normalizeResults } from "./normalize.ts";
import { filterExactMatches } from "./match.ts";
import { fetchEurRates, toEur, type Rates } from "./currency.ts";
import { mergeDuplicates } from "./dedupe.ts";

/**
 * Search API (plan steps B.1–B.4).
 *
 *   B.1 one price-sorted SERP call per country, in parallel
 *   B.2 normalise to {shop, title, price, currency, url, country, sponsored}
 *   B.3 keep exact matches (LLM), convert to EUR, merge duplicates
 *   B.4 build a price-ascending table
 *
 * It STOPS after B.4. Selecting the top 15 (B.5) is the next module's job.
 */

export interface SearchOptions {
  /** Countries to search; defaults to SEARCH_COUNTRIES or a built-in subset. */
  countries?: string[];
  /** Max results requested per country (≤100). */
  num?: number;
  /** SERP provider; defaults to live SerpApi if a key is set, else the mock. */
  provider?: SerpProvider;
  /** LLM transport override (for testing). */
  createResponse?: CreateResponseFn;
  /** Model for the match / normalise agents. */
  model?: string;
  /** FX rate source override (for testing). */
  fetchRates?: () => Promise<Rates>;
  /** Skip the LLM normalisation fallback (deterministic parsing only). */
  disableLlmFallback?: boolean;
  /** ISO timestamp for the table (inject for deterministic tests). */
  builtAt?: string | null;
}

export async function search(
  card: ProductCard,
  opts: SearchOptions = {},
): Promise<CandidateTable> {
  const countries =
    opts.countries ??
    (config.searchCountries.length > 0 ? config.searchCountries : DEFAULT_COUNTRIES);
  const provider =
    opts.provider ?? (config.hasSerpKey() ? serpApiProvider : mockSerpProvider);
  const model = opts.model ?? config.searchModel;
  const llmDeps = {
    ...(opts.createResponse ? { createResponse: opts.createResponse } : {}),
    model,
  };

  // B.1 — one SERP call per country, in parallel. A failing country yields [].
  const perCountry = await Promise.all(
    countries.map(async (country) => {
      try {
        const query = pickQueryForCountry(card, country);
        return await provider(query, country, { num: opts.num ?? 100 });
      } catch (err) {
        console.error(`[search] ${country} SERP failed:`, String(err));
        return [];
      }
    }),
  );
  const raws = perCountry.flat();

  // B.2 — normalise (deterministic, LLM fallback only where needed).
  const { candidates } = await normalizeResults(raws, {
    ...llmDeps,
    ...(opts.disableLlmFallback ? { disableLlmFallback: true } : {}),
  });

  // B.3a — keep exact matches only (LLM).
  const matched = await filterExactMatches(card, candidates, llmDeps);

  // B.3b — convert to EUR. Drop offers whose currency we can't convert.
  const rates = await (opts.fetchRates ?? fetchEurRates)();
  const converted: Candidate[] = [];
  for (const m of matched) {
    const priceEur = toEur(m.price, m.currency, rates);
    if (priceEur == null) {
      console.error(`[search] no FX rate for ${m.currency}; dropping ${m.url}`);
      continue;
    }
    converted.push({
      shop: m.shop,
      title: m.title,
      price: m.price,
      currency: m.currency,
      url: m.url,
      country: m.country,
      sponsored: m.sponsored,
      priceEur,
      seenInCountries: [m.country],
      matchReason: m.matchReason,
    });
  }

  // B.3c — merge duplicates across countries.
  const deduped = mergeDuplicates(converted);

  // B.4 — build the table in ascending EUR price order.
  const rows = deduped.sort((a, b) => a.priceEur - b.priceEur);

  const table: CandidateTable = {
    productCard: card,
    currency: "EUR",
    rows,
    meta: {
      countriesSearched: countries,
      totalRaw: raws.length,
      normalized: candidates.length,
      matched: matched.length,
      afterDedupe: deduped.length,
      fxBase: "EUR",
      builtAt: opts.builtAt ?? new Date().toISOString(),
    },
  };

  // Validate the whole table against the shared contract before returning.
  return CandidateTableSchema.parse(table);
}
