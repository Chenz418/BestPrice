import { z } from "zod";
import { SearchCandidateSchema } from "./search.ts";

/**
 * Verify + rank contracts (plan steps C and D).
 *
 *   SearchCandidate --(Dev 1 page verifier)--> PageSnapshot
 *   PageSnapshot --(Extract API, Dev 2)--> VerifiedFacts
 *   VerifiedFacts[] --(ranking, Dev 2)--> RankedResults (Top 5)
 *
 * Opening the shop page (C.1) and detecting CAPTCHA / login walls (C.6) is the
 * extension's Page verifier (Dev 1); it hands us a snapshot. We never open pages
 * from the server. Snapshot text is UNTRUSTED (prompt-injection) — treat as data.
 */

/** What the Page verifier found when it opened the page (C.1 / C.6). */
export const SnapshotOutcomeSchema = z.enum([
  "ok",
  "captcha",
  "login_wall",
  "blocked",
  "error",
]);
export type SnapshotOutcome = z.infer<typeof SnapshotOutcomeSchema>;

/** A snapshot of one shop product page (Dev 1 -> Extract API). */
export const PageSnapshotSchema = z.object({
  /** The organic candidate being verified (a row from the V2 CandidateList). */
  candidate: SearchCandidateSchema,
  /** Delivery country (ISO2) the shipping check is for. */
  deliveryCountry: z.string().length(2),
  /** The size the user wants (echoed from the query); null if none. */
  requestedSize: z.string().nullable(),
  /** How the page load went; anything but "ok" => couldn't verify (C.6). */
  outcome: SnapshotOutcomeSchema,
  /** Main product-page text, untrusted (data only). */
  pageText: z.string(),
  /** Parsed structured data (JSON-LD / schema.org Product), if any (C.3). */
  structuredData: z.unknown().optional(),
  /** Shipping/delivery page text, if fetched (C.4); cached per shop upstream. */
  shippingText: z.string().nullable().optional(),
  /** When the page was fetched. */
  fetchedAt: z.string().nullable().optional(),
});
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;

/** A promotion shown on the page (C.5) — recorded, never applied. */
export const PromotionSchema = z.object({
  text: z.string(),
  conditions: z.string().nullable(),
});
export type Promotion = z.infer<typeof PromotionSchema>;

/**
 * Facts extracted + validated from one snapshot (Extract API output, C.2–C.6).
 * Every price here must actually appear on the page (`priceConfirmedOnPage`).
 */
export const VerifiedFactsSchema = z.object({
  url: z.string().url(),
  shop: z.string(),
  country: z.string().length(2),
  /** "verified" = page read OK; "couldnt_verify" = CAPTCHA/login/blocked/error. */
  outcome: z.enum(["verified", "couldnt_verify"]),
  /** Why we couldn't verify (if applicable). */
  couldntVerifyReason: z.string().nullable(),
  /** C.2 — is this the exact same product as the card? */
  sameProduct: z.boolean(),
  /** C.3 — requested size in stock? null = couldn't tell. */
  sizeInStock: z.boolean().nullable(),
  /** C.4 — does it ship to the delivery country? null = couldn't tell. */
  shipsTo: z.boolean().nullable(),
  /** Item price on the page, converted to EUR; null if not confirmed. */
  itemPriceEur: z.number().nonnegative().nullable(),
  /** True only if the extracted price actually appears on the page. */
  priceConfirmedOnPage: z.boolean(),
  /** C.4 — shipping cost to the country in EUR; null = free/unknown. */
  shippingCostEur: z.number().nonnegative().nullable(),
  /** C.4 — free-shipping threshold in EUR, if any. */
  freeShippingThresholdEur: z.number().nonnegative().nullable(),
  /** C.5 — promotions on the page (conditions recorded, not applied). */
  promotions: z.array(PromotionSchema),
  checkedAt: z.string().nullable(),
  notes: z.string().nullable(),
});
export type VerifiedFacts = z.infer<typeof VerifiedFactsSchema>;

/**
 * A ranked offer (D.1/D.2). Ranking is by BEST PRICE even when some checks are
 * unconfirmed, so a matching product is never silently dropped just because the
 * page hid its size/shipping info. `missing` names exactly what couldn't be
 * confirmed, so the UI can show a small label; `fullyVerified` is true only when
 * `missing` is empty.
 */
export const RankedOfferSchema = VerifiedFactsSchema.extend({
  /** Price used for ranking: the guaranteed total if known, else the item price. */
  sortPriceEur: z.number().nonnegative(),
  /** Item + shipping (free-ship threshold applied); null if shipping is unknown. */
  guaranteedTotalEur: z.number().nonnegative().nullable(),
  /** True only when size, ships-to, and shipping cost are all confirmed. */
  fullyVerified: z.boolean(),
  /** Short labels for what couldn't be confirmed (empty when fullyVerified). */
  missing: z.array(z.string()),
  /** Promotions rendered as "possible extra savings" (shown separately). */
  possibleExtraSavings: z.array(z.string()),
});
export type RankedOffer = z.infer<typeof RankedOfferSchema>;

/**
 * Final output (D.3): the Top N best-price matching products + the rest.
 *
 * `top5` and `candidates` are the SAME product as the card with a confirmed price,
 * ranked cheapest-first; offers that aren't fully verified still appear here, each
 * carrying `missing` labels. `couldntVerify` is for pages we couldn't read at all
 * (CAPTCHA / login / blocked / error).
 */
export const RankedResultsSchema = z.object({
  /** Up to N best-price matching products (may include partially-verified ones). */
  top5: z.array(RankedOfferSchema),
  /** The remaining matching products beyond the Top N, same ranking. */
  candidates: z.array(RankedOfferSchema),
  /** CAPTCHA / login / blocked / error — page couldn't be read (C.6). */
  couldntVerify: z.array(VerifiedFactsSchema),
  stats: z.object({
    tableSize: z.number().int().nonnegative(),
    processed: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    /** Matching products with a confirmed price (top5 + candidates). */
    matches: z.number().int().nonnegative(),
    /** How many of those passed every check. */
    fullyVerified: z.number().int().nonnegative(),
    couldntVerify: z.number().int().nonnegative(),
  }),
});
export type RankedResults = z.infer<typeof RankedResultsSchema>;
