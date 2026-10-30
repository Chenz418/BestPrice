import { config } from "../../config.ts";
import { langForCountry } from "../countries.ts";
import { SearchError, type RawSerpResult } from "./types.ts";
import type { SerpProvider, SerpCallOptions } from "./provider.ts";

/**
 * SerpApi (serpapi.com) adapter using the plain Google WEB engine (V2 plan B).
 *
 * Why the web engine (not Google Shopping): organic results link to the shops'
 * OWN product pages, never a `google.com/shopping/product/...` aggregator. The
 * price-sorted structured feed we give up is recovered downstream by the
 * frontend's no-LLM price pre-sort (C.0) and confirmed on-page by Extract (C.2).
 *
 * Organic results rarely carry a price. When Google exposes one in a rich
 * snippet we map it as a best-effort hint; otherwise `price`/`currency` stay
 * null and the frontend peeks the page's JSON-LD.
 */

interface RichSnippetExtensions {
  price?: number;
  currency?: string;
  [k: string]: unknown;
}
interface RichSnippetBlock {
  detected_extensions?: RichSnippetExtensions;
  extensions?: string[];
}
interface GoogleOrganicResult {
  title?: string;
  link?: string;
  displayed_link?: string;
  snippet?: string;
  source?: string;
  rich_snippet?: { top?: RichSnippetBlock; bottom?: RichSnippetBlock };
}
interface GoogleResponse {
  organic_results?: GoogleOrganicResult[];
  error?: string;
}

/** Host of a URL without the leading `www.`, or null if unparseable. */
function hostOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Pull a best-effort price hint out of a result's rich snippet, if present. */
function priceFrom(r: GoogleOrganicResult): { price: number | null; currency: string | null } {
  for (const block of [r.rich_snippet?.top, r.rich_snippet?.bottom]) {
    const ext = block?.detected_extensions;
    if (ext && typeof ext.price === "number") {
      return { price: ext.price, currency: typeof ext.currency === "string" ? ext.currency : null };
    }
  }
  return { price: null, currency: null };
}

/** Map a raw SerpApi Google-web response into provider-agnostic results. */
export function mapGoogleResponse(body: GoogleResponse, country: string): RawSerpResult[] {
  if (body.error) throw new SearchError(`SerpApi (google) error: ${body.error}`);
  const out: RawSerpResult[] = [];
  for (const r of body.organic_results ?? []) {
    if (!r.title || !r.link) continue;
    const { price, currency } = priceFrom(r);
    out.push({
      title: r.title,
      priceText: null,
      price,
      currency,
      shop: r.source ?? hostOf(r.link),
      link: r.link,
      country,
      // Organic (non-ad) results; SerpApi returns ads in a separate `ads` array.
      sponsored: false,
      snippet: r.snippet ?? null,
      thumbnail: null,
      raw: r,
    });
  }
  return out;
}

/** Live SerpApi Google-web provider. Requires SERP_API_KEY. */
export const googleProvider: SerpProvider = async (
  query: string,
  country: string,
  opts: SerpCallOptions = {},
): Promise<RawSerpResult[]> => {
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    gl: country.toLowerCase(),
    hl: langForCountry(country),
    num: String(opts.num ?? 10),
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

  let body: GoogleResponse;
  try {
    body = JSON.parse(text) as GoogleResponse;
  } catch {
    throw new SearchError(`SerpApi returned non-JSON: ${text.slice(0, 500)}`);
  }
  return mapGoogleResponse(body, country);
};
