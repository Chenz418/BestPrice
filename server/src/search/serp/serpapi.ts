import { config } from "../../config.ts";
import { langForCountry } from "../countries.ts";
import { SearchError, type RawSerpResult } from "./types.ts";
import type { SerpProvider, SerpCallOptions } from "./provider.ts";

/**
 * SerpApi (serpapi.com) adapter using the Google Shopping engine (B.1).
 *
 * Why SerpApi: one call per country via `gl`, localisation via `hl`, up to ~100
 * results, and price-low-to-high sorting via the Google Shopping `tbs` token
 * `p_ord:p`. These are exactly the plan's requirements for the SERP provider.
 *
 * Note: Google Shopping links sometimes point at a Google product page rather
 * than the shop. Getting the shop's own URL can require SerpApi's immersive
 * product endpoint (plan: "use the provider's offers data to get the shop's
 * address"). For the prototype we take the best available destination link and
 * leave that enrichment to a follow-up; the Verify step never opens Google pages.
 */

/** The subset of a SerpApi shopping result we read. */
interface SerpApiShoppingResult {
  title?: string;
  link?: string;
  product_link?: string;
  source?: string;
  seller?: string;
  price?: string;
  extracted_price?: number;
  currency?: string;
  tag?: string;
  ad?: boolean;
  thumbnail?: string;
}

interface SerpApiResponse {
  shopping_results?: SerpApiShoppingResult[];
  error?: string;
}

/** Map a raw SerpApi response into provider-agnostic results. */
export function mapSerpApiResponse(
  body: SerpApiResponse,
  country: string,
): RawSerpResult[] {
  if (body.error) throw new SearchError(`SerpApi error: ${body.error}`);
  const results = body.shopping_results ?? [];
  const out: RawSerpResult[] = [];
  for (const r of results) {
    const link = r.product_link ?? r.link;
    if (!r.title || !link) continue;
    out.push({
      title: r.title,
      priceText: r.price ?? null,
      price: typeof r.extracted_price === "number" ? r.extracted_price : null,
      currency: r.currency ?? null,
      shop: r.source ?? r.seller ?? null,
      link,
      country,
      sponsored: r.ad === true || /sponsored|\bad\b/i.test(r.tag ?? ""),
      thumbnail: r.thumbnail ?? null,
      raw: r,
    });
  }
  return out;
}

/** Live SerpApi provider. Requires SERP_API_KEY. */
export const serpApiProvider: SerpProvider = async (
  query: string,
  country: string,
  opts: SerpCallOptions = {},
): Promise<RawSerpResult[]> => {
  const params = new URLSearchParams({
    engine: "google_shopping",
    q: query,
    gl: country.toLowerCase(),
    hl: langForCountry(country),
    num: String(opts.num ?? 100),
    // Google Shopping sort token: price, low to high (plan B.1).
    tbs: "p_ord:p",
    api_key: config.serpApiKey(),
  });
  const url = `https://serpapi.com/search.json?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (cause) {
    throw new SearchError(`Network error calling SerpApi: ${String(cause)}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new SearchError(
      `SerpApi returned ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
    );
  }

  let body: SerpApiResponse;
  try {
    body = JSON.parse(text) as SerpApiResponse;
  } catch {
    throw new SearchError(`SerpApi returned non-JSON: ${text.slice(0, 500)}`);
  }
  return mapSerpApiResponse(body, country);
};
