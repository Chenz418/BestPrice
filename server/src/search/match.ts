import { z } from "zod";
import type { ProductCard, NormalizedCandidate } from "@bestprice/shared";
import { callStructured, type CreateResponseFn } from "../llm/structured.ts";
import {
  MATCH_SYSTEM_PROMPT,
  MATCH_FORMAT,
  describeTarget,
  renderListings,
} from "./prompts.ts";

/**
 * Exact-match filter (B.3): ask the LLM whether each normalised candidate is the
 * same product as the card, and keep only the matches. Candidates are processed
 * in batches so a single call stays small and reliable.
 */

const MatchSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int(),
      isMatch: z.boolean(),
      reason: z.string(),
    }),
  ),
});

export interface MatchDeps {
  createResponse?: CreateResponseFn;
  model?: string;
  /** Candidates per LLM call. */
  batchSize?: number;
}

/** A candidate that passed the match filter, with the model's reason attached. */
export type MatchedCandidate = NormalizedCandidate & { matchReason: string };

async function matchBatch(
  card: ProductCard,
  batch: NormalizedCandidate[],
  deps: MatchDeps,
): Promise<MatchedCandidate[]> {
  const listings = batch.map((c) => ({ title: c.title, shop: c.shop }));
  const out = await callStructured({
    instructions: MATCH_SYSTEM_PROMPT,
    input: [
      {
        type: "input_text",
        text: `${describeTarget(card)}\n\n${renderListings(listings)}`,
      },
    ],
    format: MATCH_FORMAT,
    schema: MatchSchema,
    ...(deps.createResponse ? { createResponse: deps.createResponse } : {}),
    ...(deps.model ? { model: deps.model } : {}),
  });

  const kept: MatchedCandidate[] = [];
  for (const v of out.verdicts) {
    const candidate = batch[v.index];
    if (candidate && v.isMatch) {
      kept.push({ ...candidate, matchReason: v.reason });
    }
  }
  return kept;
}

/** Keep only candidates the LLM judges to be the exact same product (B.3). */
export async function filterExactMatches(
  card: ProductCard,
  candidates: NormalizedCandidate[],
  deps: MatchDeps = {},
): Promise<MatchedCandidate[]> {
  if (candidates.length === 0) return [];
  const batchSize = deps.batchSize ?? 25;

  const batches: NormalizedCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += batchSize) {
    batches.push(candidates.slice(i, i + batchSize));
  }

  const results = await Promise.all(batches.map((b) => matchBatch(card, b, deps)));
  return results.flat();
}
