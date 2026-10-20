import { z } from "zod";
import type { ProductCard, RepresentativeImage } from "@bestprice/shared";
import { config } from "../config.ts";
import { callStructured, type CreateResponseFn } from "../llm/structured.ts";
import { serpApiProvider } from "../search/serp/serpapi.ts";
import type { SerpProvider } from "../search/serp/provider.ts";
import type { RawSerpResult } from "../search/serp/types.ts";
import {
  MATCH_SYSTEM_PROMPT,
  MATCH_FORMAT,
  describeTarget,
  renderListings,
} from "../search/prompts.ts";

/**
 * Representative image lookup for the confirmation step (extends plan A.1).
 *
 * Policy: ALWAYS attach the most reliable image available (the user can decline
 * and pick another on the frontend). One Google Shopping SERP call → score each
 * result's title against the card → confirm the top few with the exact-match
 * agent → rank (confirmed > strong title overlap > search relevance) and return
 * the ranked candidates, best first. Uses the result THUMBNAIL (never scrapes a
 * page). Returns an empty list only when no image could be found at all.
 */

export interface ImageLookupDeps {
  /** SERP provider; defaults to live SerpApi when a key is set, else disabled. */
  provider?: SerpProvider;
  /** LLM transport (for the confirmation step and testing). */
  createResponse?: CreateResponseFn;
  /** Model for the confirmation agent. */
  model?: string;
  /** Country for the SERP call (gl); defaults to "us". */
  country?: string;
  /** Max SERP results to request. */
  num?: number;
  /** How many top-scored candidates to send to the match agent. */
  topK?: number;
  /** Max candidates to return (best first). */
  maxCandidates?: number;
  /** Skip LLM confirmation (deterministic ranking only). */
  disableVerify?: boolean;
}

const MatchSchema = z.object({
  verdicts: z.array(
    z.object({ index: z.number().int(), isMatch: z.boolean(), reason: z.string() }),
  ),
});

/** Best query for an image lookup: a concrete English-ish string from the card. */
function imageQuery(card: ProductCard): string {
  const english = card.searchQueries.find((q) => q.lang === "en");
  if (english) return english.query;
  const assembled = [card.brand, card.model, card.colour, card.styleCode]
    .filter(Boolean)
    .join(" ")
    .trim();
  return assembled || card.searchQueries[0]?.query || "";
}

/** Score a listing title by how many card attributes it contains. */
function scoreTitle(title: string, card: ProductCard): number {
  const t = title.toLowerCase();
  let s = 0;
  if (card.brand && t.includes(card.brand.toLowerCase())) s += 2;
  if (card.model && t.includes(card.model.toLowerCase())) s += 3;
  if (card.colour && t.includes(card.colour.toLowerCase())) s += 2;
  if (card.styleCode) {
    const code = card.styleCode.toLowerCase();
    const compact = (x: string) => x.replace(/[^a-z0-9]/g, "");
    if (t.includes(code) || compact(t).includes(compact(code))) s += 4;
  }
  return s;
}

/**
 * Find representative image candidates for the card, ranked best-first. Empty
 * only when no result with a thumbnail could be found. Never throws past here.
 */
export async function findRepresentativeImages(
  card: ProductCard,
  deps: ImageLookupDeps = {},
): Promise<RepresentativeImage[]> {
  if (!card.brand && !card.model) return [];

  const provider =
    deps.provider ?? (config.hasSerpKey() ? serpApiProvider : undefined);
  if (!provider) return [];

  const query = imageQuery(card);
  if (!query) return [];

  const country = (deps.country ?? "US").toLowerCase();
  const results: RawSerpResult[] = await provider(query, country, {
    num: deps.num ?? 20,
  });

  // Every result that actually has a thumbnail is a potential image.
  const withThumb = results
    .filter((r): r is RawSerpResult & { thumbnail: string } => Boolean(r.thumbnail))
    .map((r, i) => ({ r, order: i, score: scoreTitle(r.title, card) }));
  if (withThumb.length === 0) return [];

  // Confirm the strongest-looking candidates with the exact-match agent.
  const confirmed = new Set<number>();
  if (!deps.disableVerify && deps.createResponse) {
    const topBySc = [...withThumb]
      .sort((a, b) => b.score - a.score)
      .slice(0, deps.topK ?? 5);
    const listings = topBySc.map((c) => ({ title: c.r.title, shop: c.r.shop ?? "" }));
    try {
      const out = await callStructured({
        instructions: MATCH_SYSTEM_PROMPT,
        input: [
          { type: "input_text", text: `${describeTarget(card)}\n\n${renderListings(listings)}` },
        ],
        format: MATCH_FORMAT,
        schema: MatchSchema,
        ...(deps.createResponse ? { createResponse: deps.createResponse } : {}),
        ...(deps.model ? { model: deps.model } : {}),
      });
      for (const v of out.verdicts) {
        if (v.isMatch && topBySc[v.index]) confirmed.add(topBySc[v.index]!.order);
      }
    } catch {
      // Verification is best-effort; fall back to score-only ranking.
    }
  }

  const confidenceOf = (order: number, score: number) => {
    if (confirmed.has(order)) return "high" as const;
    if (score >= 5) return "medium" as const;
    return "low" as const;
  };
  const rank = (c: { order: number; score: number }) =>
    (confirmed.has(c.order) ? 1000 : 0) + c.score;

  const ranked = [...withThumb]
    .sort((a, b) => rank(b) - rank(a) || a.order - b.order)
    .slice(0, deps.maxCandidates ?? 6)
    .map((c) => ({
      imageUrl: c.r.thumbnail,
      sourceUrl: c.r.link,
      confidence: confidenceOf(c.order, c.score),
    }));

  return ranked;
}

/**
 * Return a copy of the card with the most reliable image attached (plus ranked
 * alternatives for the frontend to let the user re-pick). Resilient: any lookup
 * error leaves the image fields null/empty.
 */
export async function attachRepresentativeImage(
  card: ProductCard,
  deps: ImageLookupDeps = {},
): Promise<ProductCard> {
  const out: ProductCard = {
    ...card,
    representativeImageUrl: card.representativeImageUrl ?? null,
    representativeImageSource: card.representativeImageSource ?? null,
    representativeImageConfidence: card.representativeImageConfidence ?? null,
    representativeImageCandidates: [],
  };
  try {
    const candidates = await findRepresentativeImages(card, deps);
    if (candidates.length > 0) {
      const best = candidates[0]!;
      out.representativeImageUrl = best.imageUrl;
      out.representativeImageSource = best.sourceUrl;
      out.representativeImageConfidence = best.confidence;
      out.representativeImageCandidates = candidates;
    }
  } catch (err) {
    console.error("[identify] representative image lookup failed:", String(err));
  }
  return out;
}
