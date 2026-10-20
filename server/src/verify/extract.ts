import { z } from "zod";
import {
  type ProductCard,
  type PageSnapshot,
  type VerifiedFacts,
  VerifiedFactsSchema,
} from "@bestprice/shared";
import { config } from "../config.ts";
import { callStructured, type CreateResponseFn } from "../llm/structured.ts";
import { toEur, fetchEurRates, type Rates } from "../search/currency.ts";
import {
  EXTRACT_PRODUCT_SYSTEM_PROMPT,
  EXTRACT_PRODUCT_FORMAT,
  buildProductInput,
  EXTRACT_SHIPPING_SYSTEM_PROMPT,
  EXTRACT_SHIPPING_FORMAT,
  buildShippingInput,
} from "./prompts.ts";

/**
 * Extract API (plan C.2–C.6): one PageSnapshot -> VerifiedFacts.
 *
 * Staged and short-circuiting: if the page didn't load (C.6) we spend no LLM; if
 * C.2 (same product) or C.3 (size) fail we skip the C.4 shipping call. Every price
 * is checked against the page text before we trust it (anti-hallucination).
 */

const ProductFactsSchema = z.object({
  sameProduct: z.boolean(),
  sizeInStock: z.boolean().nullable(),
  pagePrice: z.number().nullable(),
  pageCurrency: z.string().nullable(),
  priceAppearsOnPage: z.boolean(),
  promotions: z.array(z.object({ text: z.string(), conditions: z.string().nullable() })),
  reason: z.string(),
});

const ShippingFactsSchema = z.object({
  shipsTo: z.boolean().nullable(),
  shippingCost: z.number().nullable(),
  shippingCurrency: z.string().nullable(),
  freeShippingThreshold: z.number().nullable(),
  thresholdCurrency: z.string().nullable(),
  notes: z.string().nullable(),
});

export interface ExtractDeps {
  createResponse?: CreateResponseFn;
  model?: string;
  /** EUR rates; fetched once if omitted. */
  rates?: Rates;
  /** Shipping facts cached per shop (C.4) — reused across a shop's candidates. */
  shippingCache?: Map<string, z.infer<typeof ShippingFactsSchema>>;
  /** ISO timestamp to stamp facts with (inject for deterministic tests). */
  checkedAt?: string;
}

/** Does the numeric price plausibly appear in the page text? (anti-hallucination) */
export function priceAppearsIn(text: string, price: number): boolean {
  const whole = Math.round(price).toString();
  const twoDp = price.toFixed(2);
  // Match the integer part followed by optional ,/. decimals: 139 | 139.00 | 139,00
  const intPart = Math.trunc(price).toString();
  const re = new RegExp(`\\b${intPart}\\b|${escapeRe(twoDp)}|${escapeRe(twoDp.replace(".", ","))}`);
  return re.test(text) || text.includes(whole);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function couldntVerify(snapshot: PageSnapshot, checkedAt: string | null): VerifiedFacts {
  return VerifiedFactsSchema.parse({
    url: snapshot.candidate.url,
    shop: snapshot.candidate.shop,
    country: snapshot.candidate.country,
    outcome: "couldnt_verify",
    couldntVerifyReason: snapshot.outcome, // captcha / login_wall / blocked / error
    sameProduct: false,
    sizeInStock: null,
    shipsTo: null,
    itemPriceEur: null,
    priceConfirmedOnPage: false,
    shippingCostEur: null,
    freeShippingThresholdEur: null,
    promotions: [],
    checkedAt,
    notes: null,
  });
}

/** Extract + validate facts from one snapshot (C.2–C.6). */
export async function extractFacts(
  snapshot: PageSnapshot,
  card: ProductCard,
  deps: ExtractDeps = {},
): Promise<VerifiedFacts> {
  const checkedAt = deps.checkedAt ?? new Date().toISOString();
  const { candidate } = snapshot;

  // C.6 — the page verifier couldn't give us a usable page.
  if (snapshot.outcome !== "ok") return couldntVerify(snapshot, checkedAt);

  const model = deps.model ?? config.extractModel;
  const llm = {
    ...(deps.createResponse ? { createResponse: deps.createResponse } : {}),
    model,
  };
  const rates = deps.rates ?? (await fetchEurRates());

  // Stage 1 — C.2 + C.3 + C.5 from the product page.
  const product = await callStructured({
    instructions: EXTRACT_PRODUCT_SYSTEM_PROMPT,
    input: [
      {
        type: "input_text",
        text: buildProductInput(
          card,
          candidate,
          snapshot.requestedSize,
          snapshot.pageText,
          snapshot.structuredData,
        ),
      },
    ],
    format: EXTRACT_PRODUCT_FORMAT,
    schema: ProductFactsSchema,
    ...llm,
  });

  // Validate the price actually appears on the page before trusting it.
  const confirmed =
    product.priceAppearsOnPage &&
    product.pagePrice != null &&
    priceAppearsIn(snapshot.pageText, product.pagePrice);
  const itemPriceEur =
    confirmed && product.pagePrice != null
      ? toEur(product.pagePrice, product.pageCurrency ?? candidate.currency, rates)
      : null;

  const base = {
    url: candidate.url,
    shop: candidate.shop,
    country: candidate.country,
    outcome: "verified" as const,
    couldntVerifyReason: null,
    sameProduct: product.sameProduct,
    sizeInStock: product.sizeInStock,
    itemPriceEur,
    priceConfirmedOnPage: confirmed && itemPriceEur != null,
    promotions: product.promotions,
    checkedAt,
    notes: product.reason,
  };

  // Short-circuit (C.2/C.3 failed) — skip the shipping call entirely.
  if (!product.sameProduct || product.sizeInStock !== true) {
    return VerifiedFactsSchema.parse({
      ...base,
      shipsTo: null,
      shippingCostEur: null,
      freeShippingThresholdEur: null,
    });
  }

  // Stage 2 — C.4 shipping (cached per shop).
  const cache = deps.shippingCache;
  let shipping = cache?.get(candidate.shop);
  if (!shipping) {
    const shippingText = snapshot.shippingText?.trim() || snapshot.pageText;
    shipping = await callStructured({
      instructions: EXTRACT_SHIPPING_SYSTEM_PROMPT,
      input: [
        { type: "input_text", text: buildShippingInput(snapshot.deliveryCountry, shippingText) },
      ],
      format: EXTRACT_SHIPPING_FORMAT,
      schema: ShippingFactsSchema,
      ...llm,
    });
    cache?.set(candidate.shop, shipping);
  }

  const shippingCostEur =
    shipping.shippingCost != null
      ? toEur(shipping.shippingCost, shipping.shippingCurrency ?? candidate.currency, rates)
      : null;
  const freeShippingThresholdEur =
    shipping.freeShippingThreshold != null
      ? toEur(shipping.freeShippingThreshold, shipping.thresholdCurrency ?? candidate.currency, rates)
      : null;

  return VerifiedFactsSchema.parse({
    ...base,
    shipsTo: shipping.shipsTo,
    shippingCostEur,
    freeShippingThresholdEur,
  });
}
