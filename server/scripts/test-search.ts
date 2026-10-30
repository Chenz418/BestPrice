/**
 * Manual test harness for the Search API (plan B.1–B.4).
 *
 * Builds a ProductCard from flags (or reads one with --json), runs search()
 * directly, and prints the resulting price-ascending candidate table.
 *
 * Needs OPENAI_API_KEY (match / normalise agents). Uses the live SERP provider
 * if SERP_API_KEY is set, otherwise the fixture mock. Force the mock with
 * --provider mock to test the match prompt against saved results without a SERP key.
 *
 * Usage (from repo root):
 *   # live SERP + LLM (needs both keys):
 *   npm run search -- --brand "Dr. Martens" --model "1461" --colour "Crazy Horse" --countries IT,DE,PL
 *
 *   # saved fixtures + real LLM matcher (needs only OPENAI_API_KEY):
 *   npm run search -- --json ./card.json --provider mock --countries IT,DE,PL
 *
 * Flags:
 *   --json <path>        read a whole ProductCard from a JSON file
 *   --brand --model --colour --code --category --size   build a card inline
 *   --query <text>       a search query to use (added as an 'en' query)
 *   --countries <a,b,c>  ISO2 countries to search (default: built-in subset)
 *   --provider mock|serpapi   force a SERP provider
 *   --model <id>         LLM model id for match / normalise
 *   --num <n>            max results per country (<=100)
 */
import { readFileSync } from "node:fs";
import { ProductCardSchema, type ProductCard } from "@bestprice/shared";
import { search, type SearchOptions } from "../src/search/search.ts";
import { mockSerpProvider } from "../src/search/serp/mock.ts";
import { googleProvider } from "../src/search/serp/google.ts";
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

function buildCard(args: Record<string, string>): ProductCard {
  if (args.json) {
    return ProductCardSchema.parse(JSON.parse(readFileSync(args.json, "utf8")));
  }
  return ProductCardSchema.parse({
    brand: args.brand ?? null,
    model: args.model ?? null,
    colour: args.colour ?? null,
    styleCode: args.code ?? null,
    barcode: null,
    sizeSystem: null,
    category: args.category ?? null,
    requestedSize: args.size ?? null,
    searchQueries: args.query ? [{ lang: "en", query: args.query }] : [],
    confidence: "medium",
    notes: null,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || Object.keys(args).length === 0) {
    console.log(
      "Provide a card via --json OR --brand/--model/--colour/--code.\n" +
        "See the comment at the top of this file for all flags.",
    );
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  let card: ProductCard;
  try {
    card = buildCard(args);
  } catch (err) {
    console.error("Could not build product card:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  const opts: SearchOptions = {};
  if (args.countries) {
    opts.countries = args.countries.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  }
  if (args.num && args.num !== "true") opts.num = Number(args.num);
  if (args.provider === "mock") opts.provider = mockSerpProvider;
  else if (args.provider === "serpapi" || args.provider === "google") opts.provider = googleProvider;

  console.log("=== Product card (input) ===");
  console.log(JSON.stringify(card, null, 2));
  console.log("\n=== Running Search (B, Google-direct) … ===");

  const started = process.hrtime.bigint();
  try {
    const list = await search(card, opts);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    printTable(list);
    console.log(`\n(done in ${ms.toFixed(0)} ms)`);
  } catch (err) {
    if (err instanceof SearchError) console.error("\nSERP/FX error:", err.message);
    else console.error("\nError:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

void main();
