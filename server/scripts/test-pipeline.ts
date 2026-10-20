/**
 * End-to-end test: Identify (A) -> Search (B.1–B.4).
 *
 * Builds a Query from flags, runs identify() to get a ProductCard, shows it, then
 * runs search() to build the price-ascending candidate table and prints it.
 *
 * Needs OPENAI_API_KEY (identify + match agents). Uses the live SERP provider if
 * SERP_API_KEY is set, otherwise the fixture mock.
 *
 * Usage (from repo root):
 *   npm run pipeline -- --name "carhartt i036593_2xn_4l" --model gpt-5.6-luna --countries IT,DE,FR
 *   npm run pipeline -- --code "i036593_2xn_4l" --size "4L" --country IT --model gpt-5.6-luna
 *
 * Flags:
 *   --name --code --message --image <path|url> --size --country   build the query
 *   --lang <a,b,c>       target languages for the card's search queries
 *   --countries <a,b,c>  ISO2 countries to search (default: built-in subset)
 *   --provider mock|serpapi   force a SERP provider
 *   --model <id>         LLM model id for all agents (e.g. gpt-5.6-luna)
 *   --num <n>            max SERP results per country (<=100)
 *   --no-image           skip the representative-image SERP lookup in Identify
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { QuerySchema, type Query } from "@bestprice/shared";
import { identify } from "../src/identify/identify.ts";
import { attachRepresentativeImage } from "../src/identify/representativeImage.ts";
import { search, type SearchOptions } from "../src/search/search.ts";
import { mockSerpProvider } from "../src/search/serp/mock.ts";
import { serpApiProvider } from "../src/search/serp/serpapi.ts";
import { LlmError } from "../src/llm/responsesClient.ts";
import { SearchError } from "../src/search/serp/types.ts";
import { printTable } from "./_printTable.ts";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token?.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = "true";
      else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

const MEDIA_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function resolveImage(value: string): { url: string } {
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return { url: value };
  const ext = extname(value).toLowerCase();
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) throw new Error(`Unsupported image type "${ext}".`);
  return { url: `data:${mediaType};base64,${readFileSync(value).toString("base64")}` };
}

function buildQuery(args: Record<string, string>): Query {
  const query: Query = {};
  if (args.name) query.productName = args.name;
  if (args.code) query.productCode = args.code;
  if (args.message) query.message = args.message;
  if (args.image) query.image = resolveImage(args.image);
  if (args.size) query.size = args.size;
  if (args.country) query.deliveryCountry = args.country.toUpperCase();
  if (args.lang) query.targetLanguages = args.lang.split(",").map((s) => s.trim()).filter(Boolean);
  return QuerySchema.parse(query);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || Object.keys(args).length === 0) {
    console.log("Provide at least one of --name/--code/--message/--image. See the file header for flags.");
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const model = args.model && args.model !== "true" ? args.model : undefined;

  let query: Query;
  try {
    query = buildQuery(args);
  } catch (err) {
    console.error("Could not build query:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  console.log("=== Step A: Identify ===");
  console.log("Query:", JSON.stringify({ ...query, image: query.image ? "<image>" : undefined }));

  try {
    let card = await identify(query, model ? { model } : {});
    if (!args["no-image"]) {
      card = await attachRepresentativeImage(card, {
        ...(model ? { model } : {}),
        ...(query.deliveryCountry ? { country: query.deliveryCountry } : {}),
        ...(args.provider === "mock" ? { provider: mockSerpProvider } : {}),
        ...(args.provider === "serpapi" ? { provider: serpApiProvider } : {}),
      });
    }
    console.log("\nProduct card:");
    console.log(JSON.stringify(card, null, 2));
    if (card.representativeImageUrl) {
      const alts = card.representativeImageCandidates?.length ?? 0;
      console.log(
        `\nRepresentative image (confidence: ${card.representativeImageConfidence}): ${card.representativeImageUrl}`,
      );
      console.log(`  from: ${card.representativeImageSource}`);
      if (alts > 1) console.log(`  (${alts - 1} alternative image(s) available for refind)`);
    } else {
      console.log("\nRepresentative image: (none found)");
    }

    const opts: SearchOptions = {};
    if (model) opts.model = model;
    if (args.countries) {
      opts.countries = args.countries.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
    }
    if (args.num && args.num !== "true") opts.num = Number(args.num);
    if (args.provider === "mock") opts.provider = mockSerpProvider;
    else if (args.provider === "serpapi") opts.provider = serpApiProvider;

    console.log("\n=== Step B: Search (B.1–B.4) ===");
    const started = process.hrtime.bigint();
    const table = await search(card, opts);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    printTable(table);
    console.log(`\n(search done in ${ms.toFixed(0)} ms)`);
  } catch (err) {
    if (err instanceof LlmError) console.error("\nLLM error:", err.message);
    else if (err instanceof SearchError) console.error("\nSERP/FX error:", err.message);
    else console.error("\nError:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

void main();
