/**
 * Manual test harness for the Identify API.
 *
 * It builds a Query from command-line flags (optionally reading a local image),
 * calls identify() directly (no HTTP server needed), and prints the product card.
 *
 * Usage (from repo root):
 *   npm run identify -- --name "Nike Air Force 1 '07 white" --size "EU 43"
 *   npm run identify -- --code CW2288-111 --country IT
 *   npm run identify -- --image ./photo.jpg --message "these sneakers"
 *   npm run identify -- --name "Longchamp Le Pliage" --lang en,fr,it
 *   npm run identify -- --json ./query.json
 *
 * Flags (all optional, but provide at least one of name/code/message/image):
 *   --name <text>        product name
 *   --code <text>        product / style code
 *   --message <text>     free-text note (any language)
 *   --image <path|url>   local image file OR http(s) URL
 *   --size <text>        size wanted
 *   --country <ISO2>     delivery country, e.g. IT
 *   --lang <a,b,c>       target languages for search queries (ISO 639-1)
 *   --model <id>         LLM model id (overrides IDENTIFY_MODEL for this run)
 *   --no-image           skip the representative-image SERP lookup
 *   --json <path>        read the whole Query object from a JSON file
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { QuerySchema, type Query } from "@bestprice/shared";
import { identify } from "../src/identify/identify.ts";
import { attachRepresentativeImage } from "../src/identify/representativeImage.ts";
import { LlmError } from "../src/llm/responsesClient.ts";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token?.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out[key] = "true";
      } else {
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

/** Turn an --image value (file path or URL) into an image_url string. */
function resolveImage(value: string): { url: string } {
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) {
    return { url: value };
  }
  const ext = extname(value).toLowerCase();
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) {
    throw new Error(
      `Unsupported image type "${ext}". Use jpg, png, webp, or gif.`,
    );
  }
  const base64 = readFileSync(value).toString("base64");
  return { url: `data:${mediaType};base64,${base64}` };
}

function buildQuery(args: Record<string, string>): Query {
  if (args.json) {
    const raw = JSON.parse(readFileSync(args.json, "utf8"));
    return QuerySchema.parse(raw);
  }

  const query: Query = {};
  if (args.name) query.productName = args.name;
  if (args.code) query.productCode = args.code;
  if (args.message) query.message = args.message;
  if (args.image) query.image = resolveImage(args.image);
  if (args.size) query.size = args.size;
  if (args.country) query.deliveryCountry = args.country.toUpperCase();
  if (args.lang) {
    query.targetLanguages = args.lang
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return QuerySchema.parse(query);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || Object.keys(args).length === 0) {
    console.log(
      "Provide at least one of --name / --code / --message / --image " +
        "(or --json <file>).\nSee the comment at the top of this file for all flags.",
    );
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  let query: Query;
  try {
    query = buildQuery(args);
  } catch (err) {
    console.error("Could not build query:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  // Show the input, hiding the (potentially huge) image payload.
  const printable = {
    ...query,
    image: query.image ? { url: `${query.image.url.slice(0, 40)}… (truncated)` } : undefined,
  };
  console.log("\n=== Query ===");
  console.log(JSON.stringify(printable, null, 2));

  const model = args.model && args.model !== "true" ? args.model : undefined;
  console.log(`\n=== Calling Identify API${model ? ` (model: ${model})` : ""} … ===`);
  const started = process.hrtime.bigint();
  try {
    let card = await identify(query, model ? { model } : {});
    if (!args["no-image"]) {
      card = await attachRepresentativeImage(card, {
        ...(model ? { model } : {}),
        ...(query.deliveryCountry ? { country: query.deliveryCountry } : {}),
      });
    }
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(`\n=== Product card (${ms.toFixed(0)} ms) ===`);
    console.log(JSON.stringify(card, null, 2));
  } catch (err) {
    if (err instanceof LlmError) {
      console.error("\nLLM error:", err.message);
    } else {
      console.error("\nError:", err instanceof Error ? err.message : err);
    }
    process.exitCode = 1;
  }
}

void main();
