/**
 * Offline verification of the representative-image lookup (no keys, no network).
 *
 * Drives the REAL findRepresentativeImages() with a mock Google Shopping provider
 * (results carry thumbnails) and a mock match agent, and asserts it:
 *   - ALWAYS returns the most reliable image when any result has a thumbnail,
 *   - ranks a confirmed match above weaker ones and labels confidence,
 *   - returns ranked alternatives for the frontend to re-pick,
 *   - returns nothing only when there is genuinely no image to show.
 *
 *   npx tsx server/scripts/verify-image-mock.ts
 */
import { ProductCardSchema } from "@bestprice/shared";
import {
  findRepresentativeImages,
  type ImageLookupDeps,
} from "../src/identify/representativeImage.ts";
import type { SerpProvider } from "../src/search/serp/provider.ts";
import type { RawSerpResult } from "../src/search/serp/types.ts";
import type { ResponsesRequest } from "../src/llm/responsesClient.ts";

const card = ProductCardSchema.parse({
  brand: "Carhartt",
  model: "OG Chore Coat",
  colour: "Hamilton Brown",
  styleCode: "I036593",
  barcode: null,
  sizeSystem: "alpha (S/M/L)",
  category: "jacket",
  requestedSize: "L",
  searchQueries: [{ lang: "en", query: "Carhartt WIP OG Chore Coat Hamilton Brown I036593" }],
  confidence: "high",
  notes: null,
});

const r = (p: Partial<RawSerpResult> & { title: string; link: string; thumbnail: string }): RawSerpResult => ({
  priceText: null,
  price: null,
  currency: null,
  shop: null,
  country: "US",
  sponsored: false,
  ...p,
});

const SHOP_RESULTS: RawSerpResult[] = [
  r({ title: "Carhartt WIP OG Chore Coat - Jacket - hamilton brown", link: "https://www.carhartt-wip.com/en/og-chore-coat", shop: "Carhartt WIP", thumbnail: "https://img.example/carhartt-chore-brown.jpg" }),
  r({ title: "Carhartt WIP Detroit Jacket - black", link: "https://www.zalando.com/carhartt-detroit", shop: "Zalando", thumbnail: "https://img.example/detroit-black.jpg" }),
  r({ title: "Carhartt Acrylic Watch Hat beanie", link: "https://www.example.com/carhartt-beanie", shop: "Example", thumbnail: "https://img.example/beanie.jpg" }),
  r({ title: "Carhartt WIP OG Chore Coat I036593 Oxford", link: "https://www.aboutyou.de/p/carhartt-wip/og-chore-coat", shop: "About You", thumbnail: "https://img.example/chore-code.jpg" }),
];

// Query-aware mock: only returns results when the query is about Carhartt.
const mockProvider: SerpProvider = async (query: string) =>
  /carhartt/i.test(query) ? SHOP_RESULTS : [];

/** Mock match agent: a chore coat by Carhartt is a match; others are not. */
const mockLLM = async (req: ResponsesRequest): Promise<string> => {
  const text = req.input.map((p) => (p.type === "input_text" ? p.text : "")).join("\n");
  const verdicts: Array<{ index: number; isMatch: boolean; reason: string }> = [];
  for (const m of text.matchAll(/^\[(\d+)\] shop: .*? \| title: (.*)$/gm)) {
    const index = Number(m[1]);
    const title = (m[2] ?? "").toLowerCase();
    const isMatch = title.includes("carhartt") && title.includes("chore coat");
    verdicts.push({ index, isMatch, reason: isMatch ? "Carhartt OG Chore Coat" : "different product" });
  }
  return JSON.stringify({ verdicts });
};

const deps: ImageLookupDeps = { provider: mockProvider, createResponse: mockLLM };

const images = await findRepresentativeImages(card, deps);
console.log("=== Representative images (verified, ranked best-first) ===");
console.log(JSON.stringify(images, null, 2));

// Deterministic-only path (no LLM): still always attaches the best available.
const det = await findRepresentativeImages(card, { provider: mockProvider, disableVerify: true });

// A product the SERP can't find any image for yields an empty list.
const noResultCard = ProductCardSchema.parse({
  ...card,
  brand: "Nike",
  model: "Air Force 1",
  colour: "white",
  styleCode: null,
  searchQueries: [{ lang: "en", query: "Nike Air Force 1 white" }],
});
const none = await findRepresentativeImages(noResultCard, deps);

const best = images[0];
const checks: Array<[string, boolean]> = [
  ["an image is always attached when found", best !== undefined],
  ["best is the confirmed style-code match (About You)", best?.sourceUrl === "https://www.aboutyou.de/p/carhartt-wip/og-chore-coat"],
  ["best confidence = high (confirmed)", best?.confidence === "high"],
  ["ranked alternatives returned", images.length >= 2],
  ["non-matching low-overlap items ranked last as low", images[images.length - 1]?.confidence === "low"],
  ["deterministic path still attaches an image", det.length > 0 && det[0]?.confidence === "medium"],
  ["empty list only when no image exists at all", none.length === 0],
];

console.log("\n=== Checks ===");
let allPass = true;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) allPass = false;
}
console.log(allPass ? "\nAll checks passed." : "\nSOME CHECKS FAILED.");
process.exitCode = allPass ? 0 : 1;
