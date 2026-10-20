import { z } from "zod";
import { CandidateSchema } from "./search.ts";

/**
 * Verify + rank contracts (plan steps C and D).
 *
 *   Candidate --(Dev 1 page verifier)--> PageSnapshot
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
  /** The offer being verified (from the step-B table). */
  candidate: CandidateSchema,
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

/** A qualifying offer with its honest guaranteed total (D.1/D.2). */
export const RankedOfferSchema = VerifiedFactsSchema.extend({
  /** item price + shipping (free-shipping threshold applied). */
  guaranteedTotalEur: z.number().nonnegative(),
  /** Promotions rendered as "possible extra savings" (shown separately). */
  possibleExtraSavings: z.array(z.string()),
});
export type RankedOffer = z.infer<typeof RankedOfferSchema>;

/** Final output (D.3): Top 5 by guaranteed total + the other buckets. */
export const RankedResultsSchema = z.object({
  /** Up to 5 qualifying offers, cheapest guaranteed total first. */
  top5: z.array(RankedOfferSchema),
  /** Verified, same product, in stock, ships — but shipping cost unknown. */
  shippingUnknown: z.array(VerifiedFactsSchema),
  /** CAPTCHA / login / blocked / error (C.6). */
  couldntVerify: z.array(VerifiedFactsSchema),
  stats: z.object({
    tableSize: z.number().int().nonnegative(),
    processed: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    qualified: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
    shippingUnknown: z.number().int().nonnegative(),
    couldntVerify: z.number().int().nonnegative(),
  }),
});
export type RankedResults = z.infer<typeof RankedResultsSchema>;
