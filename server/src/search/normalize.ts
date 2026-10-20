import { z } from "zod";
import {
  NormalizedCandidateSchema,
  type NormalizedCandidate,
} from "@bestprice/shared";
import { callStructured, type CreateResponseFn } from "../llm/structured.ts";
import { currencyForCountry } from "./countries.ts";
import {
  NORMALISE_SYSTEM_PROMPT,
  NORMALISE_FORMAT,
  renderRawForNormalise,
} from "./prompts.ts";
import type { RawSerpResult } from "./serp/types.ts";

/**
 * Normalisation (B.2): turn raw SERP results into {shop, title, price, currency,
 * url, country, sponsored}. A deterministic parser handles the common cases; only
 * results it can't price are escalated to the LLM fallback.
 */

const KNOWN_CODES =
  /\b(EUR|USD|GBP|PLN|SEK|DKK|NOK|CZK|HUF|RON|BGN|CHF)\b/i;

const SYMBOL_TO_CODE: Array<[string, string]> = [
  ["€", "EUR"],
  ["£", "GBP"],
  ["zł", "PLN"],
  ["Kč", "CZK"],
  ["Ft", "HUF"],
  ["lei", "RON"],
  ["лв", "BGN"],
  ["$", "USD"],
];

/** Parse a messy price string into a number, handling EU and US separators. */
export function parsePrice(text: string | null): number | null {
  if (!text) return null;
  const match = text.replace(/\s/g, "").match(/[\d.,]+/);
  if (!match) return null;
  let s = match[0];
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  if (hasDot && hasComma) {
    // The separator that appears LAST is the decimal one.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(/,/g, ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    const parts = s.split(",");
    const last = parts[parts.length - 1] ?? "";
    s = parts.length === 2 && last.length === 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (hasDot) {
    const parts = s.split(".");
    const last = parts[parts.length - 1] ?? "";
    // "12.99" -> decimal; "1.299" / "1.299.000" -> thousands.
    if (!(parts.length === 2 && last.length === 2)) s = s.replace(/\./g, "");
  }

  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Normalise an explicit currency code, or null if not a 3-letter code. */
function normalizeCode(code: string | null): string | null {
  return code && /^[A-Za-z]{3}$/.test(code) ? code.toUpperCase() : null;
}

/** Infer currency from a price string (symbols / embedded code), else null. */
export function inferCurrency(text: string | null, country: string): string | null {
  if (text) {
    const codeMatch = text.match(KNOWN_CODES);
    if (codeMatch) return codeMatch[0].toUpperCase();
    for (const [symbol, code] of SYMBOL_TO_CODE) {
      if (text.includes(symbol)) return code;
    }
    // "kr" is shared by SEK/DKK/NOK — defer to the search country.
    if (/\bkr\b/i.test(text)) {
      const c = currencyForCountry(country);
      return ["SEK", "DKK", "NOK"].includes(c) ? c : "SEK";
    }
  }
  return null;
}

/** Derive a clean shop name from a URL's domain. */
export function shopFromUrl(url: URL): string {
  const host = url.hostname.replace(/^www\./, "");
  const parts = host.split(".");
  const sld = parts.length >= 2 ? parts[parts.length - 2]! : parts[0]!;
  return sld.charAt(0).toUpperCase() + sld.slice(1);
}

interface DeterministicResult {
  candidate: NormalizedCandidate | null;
  /** True when the price couldn't be parsed and the LLM should try. */
  needsLlm: boolean;
}

/** Deterministic normalisation of a single raw result. */
export function normalizeDeterministic(raw: RawSerpResult): DeterministicResult {
  let url: URL;
  try {
    url = new URL(raw.link);
  } catch {
    return { candidate: null, needsLlm: false }; // unusable link; drop
  }

  const country = raw.country.toUpperCase();
  const shop = raw.shop?.trim() || shopFromUrl(url);
  const currency =
    normalizeCode(raw.currency) ??
    inferCurrency(raw.priceText, country) ??
    currencyForCountry(country);
  const price = raw.price ?? parsePrice(raw.priceText);

  if (price == null) return { candidate: null, needsLlm: true };

  const parsed = NormalizedCandidateSchema.safeParse({
    shop,
    title: raw.title,
    price,
    currency,
    url: raw.link,
    country,
    sponsored: raw.sponsored,
  });
  return parsed.success
    ? { candidate: parsed.data, needsLlm: false }
    : { candidate: null, needsLlm: false };
}

// LLM fallback output schema (mirrors NORMALISE_FORMAT).
const LlmNormaliseSchema = z.object({
  items: z.array(
    z.object({
      index: z.number().int(),
      price: z.number().nullable(),
      currency: z.string().nullable(),
      shop: z.string().nullable(),
    }),
  ),
});

export interface NormalizeDeps {
  createResponse?: CreateResponseFn;
  model?: string;
  /** Skip the LLM fallback entirely (deterministic only). */
  disableLlmFallback?: boolean;
}

/** LLM fallback: fill price/currency/shop for results the parser couldn't. */
async function normalizeWithLlm(
  raws: RawSerpResult[],
  deps: NormalizeDeps,
): Promise<NormalizedCandidate[]> {
  const out = await callStructured({
    instructions: NORMALISE_SYSTEM_PROMPT,
    input: [{ type: "input_text", text: renderRawForNormalise(raws) }],
    format: NORMALISE_FORMAT,
    schema: LlmNormaliseSchema,
    ...(deps.createResponse ? { createResponse: deps.createResponse } : {}),
    ...(deps.model ? { model: deps.model } : {}),
  });

  const candidates: NormalizedCandidate[] = [];
  for (const item of out.items) {
    const raw = raws[item.index];
    if (!raw || item.price == null) continue;
    let url: URL;
    try {
      url = new URL(raw.link);
    } catch {
      continue;
    }
    const country = raw.country.toUpperCase();
    const parsed = NormalizedCandidateSchema.safeParse({
      shop: item.shop?.trim() || raw.shop?.trim() || shopFromUrl(url),
      title: raw.title,
      price: item.price,
      currency: normalizeCode(item.currency) ?? currencyForCountry(country),
      url: raw.link,
      country,
      sponsored: raw.sponsored,
    });
    if (parsed.success) candidates.push(parsed.data);
  }
  return candidates;
}

export interface NormalizeResult {
  candidates: NormalizedCandidate[];
  /** How many results were escalated to the LLM fallback. */
  escalated: number;
}

/** Normalise a batch of raw results (B.2), using the LLM only where needed. */
export async function normalizeResults(
  raws: RawSerpResult[],
  deps: NormalizeDeps = {},
): Promise<NormalizeResult> {
  const candidates: NormalizedCandidate[] = [];
  const toLlm: RawSerpResult[] = [];

  for (const raw of raws) {
    const det = normalizeDeterministic(raw);
    if (det.candidate) candidates.push(det.candidate);
    else if (det.needsLlm) toLlm.push(raw);
  }

  let escalated = 0;
  if (toLlm.length > 0 && !deps.disableLlmFallback) {
    escalated = toLlm.length;
    const fixed = await normalizeWithLlm(toLlm, deps);
    candidates.push(...fixed);
  }

  return { candidates, escalated };
}
