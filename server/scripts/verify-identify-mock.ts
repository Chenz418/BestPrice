/**
 * Offline verification of the Identify pipeline (no network, no API key).
 *
 * It feeds a realistic model response for the Dr. Martens query through the REAL
 * identify() code path — user-text build, JSON unfence, parse, and zod validation
 * against the shared ProductCard contract — and prints the resulting card.
 *
 * This proves the pipeline produces an ideal, valid card given a well-formed LLM
 * response. Swap the mock for a live key to get a real card (see README).
 *
 *   npx tsx server/scripts/verify-identify-mock.ts
 */
import { QuerySchema } from "@bestprice/shared";
import { identify } from "../src/identify/identify.ts";
import type { ResponsesRequest } from "../src/llm/responsesClient.ts";

const query = QuerySchema.parse({
  productName: "dr martens 1461 crazy horse",
  size: "EU 42",
  deliveryCountry: "IT",
  targetLanguages: ["en", "de", "it"],
});

// A realistic response the LLM would return for this product (wrapped in a code
// fence on purpose, to exercise the unfence step).
const mockCreateResponse = async (req: ResponsesRequest): Promise<string> => {
  // Sanity: the prompt should ask for exactly the requested languages.
  if (!req.input.some((p) => p.type === "input_text" && p.text.includes("en, de, it"))) {
    throw new Error("prompt did not request the expected languages");
  }
  return [
    "```json",
    JSON.stringify({
      brand: "Dr. Martens",
      model: "1461",
      colour: "Crazy Horse (Gaucho brown)",
      styleCode: null,
      barcode: null,
      sizeSystem: "EU",
      category: "shoes",
      requestedSize: "EU 42",
      searchQueries: [
        { lang: "en", query: "Dr. Martens 1461 Crazy Horse shoes gaucho" },
        { lang: "de", query: "Dr. Martens 1461 Crazy Horse Halbschuhe gaucho" },
        { lang: "it", query: "Dr. Martens 1461 Crazy Horse scarpe gaucho" },
      ],
      confidence: "high",
      notes:
        "1461 is the 3-eye shoe; Crazy Horse is a waxed-leather finish (often 'Gaucho'). Confirm the exact colour before searching.",
    }),
    "```",
  ].join("\n");
};

const card = await identify(query, { createResponse: mockCreateResponse });

console.log("=== Verified ProductCard (mock LLM, full pipeline) ===");
console.log(JSON.stringify(card, null, 2));
console.log("\nOK: output validated against the shared ProductCard contract.");
