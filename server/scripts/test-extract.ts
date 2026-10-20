/**
 * Manual test harness for the Extract API (plan C.2–C.6).
 *
 * Reads a JSON file containing { snapshot, productCard } and prints the extracted
 * VerifiedFacts. Needs OPENAI_API_KEY (and network for FX). Because opening real
 * shop pages is Dev 1's Page verifier, you supply a saved/hand-made snapshot here.
 *
 *   npm run extract -- --json ./snapshot.json --model gpt-5.6-luna
 *
 * The JSON file shape:
 *   { "productCard": { ...ProductCard... },
 *     "snapshot": { "candidate": {...Candidate...}, "deliveryCountry": "IT",
 *                   "requestedSize": "EU 42", "outcome": "ok",
 *                   "pageText": "...", "shippingText": "..." } }
 *
 * The whole table -> Top 5 loop (which opens pages) is verified offline with
 * `npm run verify:rank`, since page-opening belongs to the extension.
 */
import { readFileSync } from "node:fs";
import { PageSnapshotSchema, ProductCardSchema } from "@bestprice/shared";
import { extractFacts } from "../src/verify/extract.ts";
import { LlmError } from "../src/llm/responsesClient.ts";
import { SearchError } from "../src/search/serp/types.ts";

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.json || args.help) {
    console.log("Usage: npm run extract -- --json ./snapshot.json [--model <id>]");
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  let snapshot, productCard;
  try {
    const raw = JSON.parse(readFileSync(args.json, "utf8"));
    snapshot = PageSnapshotSchema.parse(raw.snapshot);
    productCard = ProductCardSchema.parse(raw.productCard);
  } catch (err) {
    console.error("Could not read/parse input:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  const model = args.model && args.model !== "true" ? args.model : undefined;
  console.log(`=== Extract (C.2–C.6)${model ? ` model: ${model}` : ""} ===`);
  try {
    const facts = await extractFacts(snapshot, productCard, model ? { model } : {});
    console.log(JSON.stringify(facts, null, 2));
  } catch (err) {
    if (err instanceof LlmError) console.error("\nLLM error:", err.message);
    else if (err instanceof SearchError) console.error("\nFX error:", err.message);
    else console.error("\nError:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

void main();
