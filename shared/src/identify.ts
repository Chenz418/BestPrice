import { z } from "zod";

/**
 * Identify module contracts (A.1 / A.2 in the plan).
 *
 *   Query (user input)  ->  [Identify API]  ->  ProductCard
 *
 * The ProductCard is a shared contract: the Search API consumes its
 * `searchQueries` and attributes, and the side panel shows it to the user for
 * confirmation (A.2). Per the contract rule, only ever ADD optional fields here
 * — never rename or remove existing ones.
 */

/** ISO 639-1 language code paired with a ready-to-run shop search string. */
export const SearchQuerySchema = z.object({
  /** ISO 639-1 language code, e.g. "en", "de", "it". */
  lang: z.string().min(2).max(5),
  /** A natural query a shopper would type on a store/marketplace in that language. */
  query: z.string().min(1),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/**
 * The user's raw input. At least one of {message, productName, productCode,
 * image} must be present — enforced by `QuerySchema` below.
 */
export const QuerySchema = z
  .object({
    /** Free-text note from the user (may describe the product in any language). */
    message: z.string().trim().min(1).optional(),
    /** Product name as the user typed it. */
    productName: z.string().trim().min(1).optional(),
    /** Manufacturer / style / article code the user typed. */
    productCode: z.string().trim().min(1).optional(),
    /**
     * A product photo. Either a full data URL ("data:image/jpeg;base64,...")
     * or a public https URL. Base64 payloads are sent inline to the vision LLM.
     */
    image: z
      .object({
        /** data: URL or https: URL pointing at the image. */
        url: z.string().min(1),
      })
      .optional(),
    /** Required at the app level for Search; Identify records it as context only. */
    size: z.string().trim().min(1).optional(),
    /** Delivery country (ISO 3166-1 alpha-2), used downstream for shipping. */
    deliveryCountry: z.string().trim().length(2).optional(),
    /** Languages the card's search queries should cover (ISO 639-1). */
    targetLanguages: z.array(z.string().min(2).max(5)).optional(),
  })
  .refine(
    (q) => Boolean(q.message || q.productName || q.productCode || q.image),
    {
      message:
        "Provide at least one of: message, productName, productCode, or image.",
    },
  );
export type Query = z.infer<typeof QuerySchema>;

/** How sure the model is about the identification overall. */
export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/**
 * A candidate product image (from a Google Shopping thumbnail) with a reliability
 * hint. `high` = confirmed exact match; `medium` = strong title overlap;
 * `low` = best available by search relevance only.
 */
export const RepresentativeImageSchema = z.object({
  imageUrl: z.string().url(),
  sourceUrl: z.string().url(),
  confidence: ConfidenceSchema,
});
export type RepresentativeImage = z.infer<typeof RepresentativeImageSchema>;

/**
 * The product card (plan A.1). Every identifying field is nullable: the model
 * MUST return null rather than guess when a value is not supported by the input.
 */
export const ProductCardSchema = z.object({
  /** Brand / manufacturer, e.g. "Nike". */
  brand: z.string().nullable(),
  /** Model or product line, e.g. "Air Force 1 '07". */
  model: z.string().nullable(),
  /** Colour or colourway as named by the brand, e.g. "Triple White". */
  colour: z.string().nullable(),
  /** Style / article / reference code, e.g. "CW2288-111". */
  styleCode: z.string().nullable(),
  /** Barcode (EAN-13 / UPC-A) only if visible in the image or given by the user. */
  barcode: z.string().nullable(),
  /** Size system the product uses, e.g. "EU", "US", "UK", "IT", "alpha (S/M/L)". */
  sizeSystem: z.string().nullable(),
  /** Broad product category, e.g. "sneakers", "handbag". */
  category: z.string().nullable(),
  /** Size the user is looking for, echoed back for confirmation (may be null). */
  requestedSize: z.string().nullable(),
  /** One ready-to-run search string per target language. */
  searchQueries: z.array(SearchQuerySchema),
  /** Overall confidence in the identification. */
  confidence: ConfidenceSchema,
  /** Short, user-facing caveats: ambiguity, assumptions, what to confirm. */
  notes: z.string().nullable(),
  /**
   * Representative product image for the confirmation step, taken from a Google
   * Shopping result's thumbnail (never scraped from a page). The most reliable
   * available image is ALWAYS attached when any was found; the user can decline
   * and pick another on the frontend. Null only when no image could be found.
   * Added AFTER the LLM builds the card, so these are optional in the contract.
   */
  representativeImageUrl: z.string().url().nullable().optional(),
  /** The shop listing the representative image came from, or null. */
  representativeImageSource: z.string().url().nullable().optional(),
  /** Reliability of the attached image (so the frontend can prompt to confirm). */
  representativeImageConfidence: ConfidenceSchema.nullable().optional(),
  /** Ranked alternative images (best first) so the user can "refind" instantly. */
  representativeImageCandidates: z.array(RepresentativeImageSchema).optional(),
});
export type ProductCard = z.infer<typeof ProductCardSchema>;
