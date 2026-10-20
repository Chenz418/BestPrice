/**
 * Full backend pipeline test: Identify (A) -> Search (B) -> Verify + Rank (C/D).
 *
 * Builds a Query from flags (incl. an image), runs the whole chain, and prints the
 * product card, the candidate table, and the final Top 5 by guaranteed total.
 *
 * Uses the server-side HTTP page verifier (see pageVerifier.ts) so the backend
 * runs end-to-end without the extension. Expect many real shops to return
 * CAPTCHA/blocked from a server IP — those show up as "couldn't verify".
 *
 * Needs OPENAI_API_KEY (identify/search/extract agents) and SERP_API_KEY (search +
 * image lookup). Network also used for FX and page fetches.
 *
 * Usage (from repo root):
 *   npm run full -- \
 *     --name "Carhartt WIP Denim OG Detroit Jacket Blue Dark Used" \
 *     --code "i036593_2xn_4l" --image "/home/zc/BestPrice/Products/Pasted image.png" \
 *     --size "L" --country IT --model gpt-6.1-sol --countries eurozone
 *
 * Flags:
 *   --name --code --message --image <path|url> --size --country   build the query
 *   --countries eurozone | eu | <a,b,c>   which countries to search (default eurozone)
 *   --model <id>        LLM model for all agents (e.g. gpt-6.1-sol)
 *   --batch <n>         verify batch size (default 15)      --target <n>  Top N (default 5)
 *   --concurrency <n>   pages verified at once (default 3)  --num <n>     SERP results/country
 *   --no-image          skip the representative-image lookup
 *   --provider mock|serpapi   force a SERP provider
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import {
  QuerySchema,
  type Query,
} from "@bestprice/shared";
import { identify } from "../src/identify/identify.ts";
import { attachRepresentativeImage } from "../src/identify/representativeImage.ts";
import { search, type SearchOptions } from "../src/search/search.ts";
import { verifyAndRank } from "../src/verify/verifyAndRank.ts";
import { httpPageVerifier } from "../src/verify/pageVerifier.ts";
import { EUROZONE_COUNTRIES, EU_COUNTRIES } from "../src/search/countries.ts";
import { mockSerpProvider } from "../src/search/serp/mock.ts";
import { serpApiProvider } from "../src/search/serp/serpapi.ts";
import { LlmError } from "../src/llm/responsesClient.ts";
import { SearchError } from "../src/search/serp/types.ts";
import { printTable, printRanked } from "./_printTable.ts";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t?.startsWith("--")) {
      const key = t.slice(2);
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
  const q: Query = {};
  if (args.name) q.productName = args.name;
  if (args.code) q.productCode = args.code;
  if (args.message) q.message = args.message;
  if (args.image) q.image = resolveImage(args.image);
  if (args.size) q.size = args.size;
  if (args.country) q.deliveryCountry = args.country.toUpperCase();
  return QuerySchema.parse(q);
}

function resolveCountries(arg: string | undefined): string[] {
  if (!arg || arg === "eurozone") return EUROZONE_COUNTRIES;
  if (arg === "eu") return Object.keys(EU_COUNTRIES).sort();
  return arg.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || Object.keys(args).length === 0) {
    console.log("See the header of this file for usage and flags.");
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const model = args.model && args.model !== "true" ? args.model : undefined;
  const countries = resolveCountries(args.countries);
  let query: Query;
  try {
    query = buildQuery(args);
  } catch (err) {
    console.error("Could not build query:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  console.log("=== STEP A: Identify ===");
  console.log("Query:", JSON.stringify({ ...query, image: query.image ? "<image attached>" : undefined }));
  console.log(`Searching ${countries.length} countries: ${countries.join(", ")}`);

  try {
    // A — identify + representative image
    let card = await identify(query, model ? { model } : {});
    if (!args["no-image"]) {
      card = await attachRepresentativeImage(card, {
        ...(model ? { model } : {}),
        ...(query.deliveryCountry ? { country: query.deliveryCountry } : {}),
      });
    }
    console.log("\nProduct card:");
    console.log(JSON.stringify(card, null, 2));

    // B — search
    const searchOpts: SearchOptions = { countries };
    if (model) searchOpts.model = model;
    if (args.num && args.num !== "true") searchOpts.num = Number(args.num);
    if (args.provider === "mock") searchOpts.provider = mockSerpProvider;
    else if (args.provider === "serpapi") searchOpts.provider = serpApiProvider;

    console.log("\n=== STEP B: Search (B.1–B.4) ===");
    const table = await search(card, searchOpts);
    printTable(table);

    // C + D — verify and rank, using the HTTP page verifier
    console.log("\n=== STEP C/D: Verify + Rank ===");
    const results = await verifyAndRank(table, {
      verify: httpPageVerifier,
      deliveryCountry: query.deliveryCountry ?? "IT",
      requestedSize: query.size ?? null,
      ...(model ? { model } : {}),
      batchSize: args.batch && args.batch !== "true" ? Number(args.batch) : 15,
      target: args.target && args.target !== "true" ? Number(args.target) : 5,
      concurrency: args.concurrency && args.concurrency !== "true" ? Number(args.concurrency) : 3,
    });
    printRanked(results);
  } catch (err) {
    if (err instanceof LlmError) console.error("\nLLM error:", err.message);
    else if (err instanceof SearchError) console.error("\nSERP/FX error:", err.message);
    else console.error("\nError:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

void main();
