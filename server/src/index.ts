import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z, ZodError } from "zod";
import {
  QuerySchema,
  ProductCardSchema,
  PageSnapshotSchema,
  VerifiedFactsSchema,
  CandidateTableSchema,
  rankVerified,
} from "@bestprice/shared";
import { config } from "./config.ts";
import { identify } from "./identify/identify.ts";
import { attachRepresentativeImage } from "./identify/representativeImage.ts";
import { search } from "./search/search.ts";
import { extractFacts } from "./verify/extract.ts";
import { verifyAndRank } from "./verify/verifyAndRank.ts";
import { httpPageVerifier } from "./verify/pageVerifier.ts";
import { LlmError } from "./llm/responsesClient.ts";
import { SearchError } from "./search/serp/types.ts";

/**
 * Identify API HTTP server (plan step A, server side).
 *
 *   POST /identify   body: Query (JSON)   ->   ProductCard (JSON)
 *   GET  /health     ->   { ok: true }
 *
 * The extension's orchestrator calls this; the side panel then shows the card
 * for the user to confirm (A.2) before Search runs.
 */

const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8 MB — room for an inline base64 image.

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleIdentify(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, { error: "Request body must be valid JSON." });
    return;
  }

  const parsed = QuerySchema.safeParse(json);
  if (!parsed.success) {
    sendJson(res, 400, {
      error: "Invalid query.",
      details: parsed.error.flatten(),
    });
    return;
  }

  try {
    const card = await identify(parsed.data);
    // Attach a representative image for the confirmation step (A.2). Resilient:
    // never fails the request if the SERP lookup errors or finds nothing.
    const withImage = await attachRepresentativeImage(card, {
      ...(parsed.data.deliveryCountry ? { country: parsed.data.deliveryCountry } : {}),
    });
    sendJson(res, 200, withImage);
  } catch (err) {
    if (err instanceof LlmError) {
      sendJson(res, 502, { error: "Upstream LLM error.", detail: err.message });
    } else if (err instanceof ZodError) {
      sendJson(res, 422, { error: "Model output invalid.", detail: err.message });
    } else {
      sendJson(res, 500, { error: "Internal error.", detail: String(err) });
    }
  }
}

/** Body for POST /search: a ProductCard plus optional search controls. */
const SearchBodySchema = z.object({
  productCard: ProductCardSchema,
  countries: z.array(z.string().length(2)).optional(),
  num: z.number().int().positive().max(100).optional(),
  model: z.string().optional(),
});

async function handleSearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, { error: "Request body must be valid JSON." });
    return;
  }

  const parsed = SearchBodySchema.safeParse(json);
  if (!parsed.success) {
    sendJson(res, 400, {
      error: "Invalid search body (expects { productCard, countries?, num?, model? }).",
      details: parsed.error.flatten(),
    });
    return;
  }

  const { productCard, ...opts } = parsed.data;
  try {
    const table = await search(productCard, opts);
    sendJson(res, 200, table);
  } catch (err) {
    if (err instanceof LlmError) {
      sendJson(res, 502, { error: "Upstream LLM error.", detail: err.message });
    } else if (err instanceof SearchError) {
      sendJson(res, 502, { error: "SERP / FX error.", detail: err.message });
    } else if (err instanceof ZodError) {
      sendJson(res, 422, { error: "Result failed validation.", detail: err.message });
    } else {
      sendJson(res, 500, { error: "Internal error.", detail: String(err) });
    }
  }
}

/** Body for POST /extract: a page snapshot plus the target product card. */
const ExtractBodySchema = z.object({
  snapshot: PageSnapshotSchema,
  productCard: ProductCardSchema,
  model: z.string().optional(),
});

async function handleExtract(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, { error: "Request body must be valid JSON." });
    return;
  }
  const parsed = ExtractBodySchema.safeParse(json);
  if (!parsed.success) {
    sendJson(res, 400, {
      error: "Invalid body (expects { snapshot, productCard, model? }).",
      details: parsed.error.flatten(),
    });
    return;
  }
  try {
    const facts = await extractFacts(parsed.data.snapshot, parsed.data.productCard, {
      ...(parsed.data.model ? { model: parsed.data.model } : {}),
    });
    sendJson(res, 200, facts);
  } catch (err) {
    if (err instanceof LlmError) sendJson(res, 502, { error: "Upstream LLM error.", detail: err.message });
    else if (err instanceof SearchError) sendJson(res, 502, { error: "FX error.", detail: err.message });
    else if (err instanceof ZodError) sendJson(res, 422, { error: "Result failed validation.", detail: err.message });
    else sendJson(res, 500, { error: "Internal error.", detail: String(err) });
  }
}

/** Body for POST /rank: verified facts to rank (pure D.1/D.2). */
const RankBodySchema = z.object({
  facts: z.array(VerifiedFactsSchema),
  tableSize: z.number().int().nonnegative().optional(),
  top: z.number().int().positive().optional(),
});

async function handleRank(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, { error: "Request body must be valid JSON." });
    return;
  }
  const parsed = RankBodySchema.safeParse(json);
  if (!parsed.success) {
    sendJson(res, 400, { error: "Invalid body (expects { facts, tableSize?, top? }).", details: parsed.error.flatten() });
    return;
  }
  const { facts, tableSize, top } = parsed.data;
  const results = rankVerified(facts, {
    tableSize: tableSize ?? facts.length,
    processed: facts.length,
    ...(top ? { top } : {}),
  });
  sendJson(res, 200, results);
}

/** Body for POST /verify: a step-B table; runs C+D with the HTTP page verifier. */
const VerifyBodySchema = z.object({
  table: CandidateTableSchema,
  deliveryCountry: z.string().length(2).optional(),
  requestedSize: z.string().nullable().optional(),
  model: z.string().optional(),
  batchSize: z.number().int().positive().optional(),
  target: z.number().int().positive().optional(),
  concurrency: z.number().int().positive().max(8).optional(),
});

async function handleVerify(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, { error: "Request body must be valid JSON." });
    return;
  }
  const parsed = VerifyBodySchema.safeParse(json);
  if (!parsed.success) {
    sendJson(res, 400, { error: "Invalid body (expects { table, ... }).", details: parsed.error.flatten() });
    return;
  }
  const { table, ...opts } = parsed.data;
  try {
    const results = await verifyAndRank(table, { verify: httpPageVerifier, ...opts });
    sendJson(res, 200, results);
  } catch (err) {
    if (err instanceof LlmError) sendJson(res, 502, { error: "Upstream LLM error.", detail: err.message });
    else if (err instanceof SearchError) sendJson(res, 502, { error: "FX error.", detail: err.message });
    else if (err instanceof ZodError) sendJson(res, 422, { error: "Result failed validation.", detail: err.message });
    else sendJson(res, 500, { error: "Internal error.", detail: String(err) });
  }
}

const server = createServer((req, res) => {
  const { method, url } = req;

  if (method === "GET" && url === "/health") {
    sendJson(res, 200, {
      ok: true,
      identifyModel: config.identifyModel,
      searchModel: config.searchModel,
    });
    return;
  }

  if (method === "POST" && url === "/identify") {
    handleIdentify(req, res).catch((err) => {
      sendJson(res, 500, { error: "Internal error.", detail: String(err) });
    });
    return;
  }

  if (method === "POST" && url === "/search") {
    handleSearch(req, res).catch((err) => {
      sendJson(res, 500, { error: "Internal error.", detail: String(err) });
    });
    return;
  }

  if (method === "POST" && url === "/extract") {
    handleExtract(req, res).catch((err) => {
      sendJson(res, 500, { error: "Internal error.", detail: String(err) });
    });
    return;
  }

  if (method === "POST" && url === "/rank") {
    handleRank(req, res).catch((err) => {
      sendJson(res, 500, { error: "Internal error.", detail: String(err) });
    });
    return;
  }

  if (method === "POST" && url === "/verify") {
    handleVerify(req, res).catch((err) => {
      sendJson(res, 500, { error: "Internal error.", detail: String(err) });
    });
    return;
  }

  sendJson(res, 404, { error: "Not found." });
});

server.listen(config.port, () => {
  console.log(`[identify] listening on http://localhost:${config.port}`);
  console.log(`[identify] model: ${config.identifyModel}`);
  console.log(`[identify] proxy: ${config.openaiBaseUrl}`);
});
