import type { JsonSchemaFormat } from "../llm/responsesClient.ts";

/**
 * JSON Schema for the ProductCard, in the shape the Responses API `json_schema`
 * format expects under strict mode:
 *   - every property listed in `required`
 *   - `additionalProperties: false`
 *   - nullable fields typed as ["string", "null"]
 *
 * This mirrors `ProductCardSchema` in @bestprice/shared; the LLM output is still
 * re-validated with the zod schema after parsing, so the two cannot silently
 * diverge without a test failure.
 */
export const PRODUCT_CARD_FORMAT: JsonSchemaFormat = {
  type: "json_schema",
  name: "product_card",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "brand",
      "model",
      "colour",
      "styleCode",
      "barcode",
      "sizeSystem",
      "category",
      "requestedSize",
      "searchQueries",
      "confidence",
      "notes",
    ],
    properties: {
      brand: { type: ["string", "null"], description: "Brand / manufacturer." },
      model: {
        type: ["string", "null"],
        description: "Model or product line.",
      },
      colour: {
        type: ["string", "null"],
        description: "Colour / colourway as named by the brand.",
      },
      styleCode: {
        type: ["string", "null"],
        description: "Style / article / reference code. Null if not certain.",
      },
      barcode: {
        type: ["string", "null"],
        description:
          "EAN-13 / UPC-A barcode, only if visible in the image or given by the user. Never invent one.",
      },
      sizeSystem: {
        type: ["string", "null"],
        description: 'Size system, e.g. "EU", "US", "UK", "IT", "alpha (S/M/L)".',
      },
      category: {
        type: ["string", "null"],
        description: 'Broad product category, e.g. "sneakers", "handbag".',
      },
      requestedSize: {
        type: ["string", "null"],
        description: "The size the user asked for, echoed back. Null if none.",
      },
      searchQueries: {
        type: "array",
        description: "One ready-to-run search string per target language.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["lang", "query"],
          properties: {
            lang: {
              type: "string",
              description: "ISO 639-1 language code, e.g. 'en', 'de', 'it'.",
            },
            query: {
              type: "string",
              description: "Natural shop search string in that language.",
            },
          },
        },
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "Overall confidence in the identification.",
      },
      notes: {
        type: ["string", "null"],
        description: "Short user-facing caveats, assumptions, what to confirm.",
      },
    },
  },
};
