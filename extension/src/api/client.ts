import {
  QuerySchema,
  ProductCardSchema,
  CandidateListSchema,
  PageSnapshotSchema,
  VerifiedFactsSchema,
  RankedResultsSchema,
} from "@bestprice/shared";
import type {
  Query,
  ProductCard,
  CandidateList,
  PageSnapshot,
  VerifiedFacts,
  RankedResults,
} from "@bestprice/shared";
import { z } from "zod";
import { config } from "../config.ts";

/**
 * Typed client for the BestPrice backend (docs/API_CONTRACT.md). Every response is
 * validated against the shared zod schema, so a contract drift fails loudly here
 * rather than corrupting the pipeline downstream.
 *
 * The side panel is an extension page with `host_permissions` for the backend
 * origin, so these cross-origin fetches are not subject to CORS.
 */

/** Error carrying the HTTP status and the backend's JSON error body (if any). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const HealthSchema = z.object({
  ok: z.literal(true),
  identifyModel: z.string(),
  searchModel: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;

const FxSchema = z.object({
  base: z.string(),
  rates: z.record(z.string(), z.number()),
  fetchedAt: z.string(),
});
export type Fx = z.infer<typeof FxSchema>;

interface RequestOpts {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Combine an external abort signal with a per-request timeout. */
function withTimeout(opts: RequestOpts): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("request timed out")),
    opts.timeoutMs ?? config.requestTimeoutMs,
  );
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort(opts.signal.reason);
    else opts.signal.addEventListener("abort", () => controller.abort(opts.signal?.reason), { once: true });
  }
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function parseError(res: Response): Promise<ApiError> {
  let body: unknown;
  let message = `${res.status} ${res.statusText}`;
  try {
    body = await res.json();
    if (body && typeof body === "object" && "error" in body) {
      message = String((body as { error: unknown }).error);
    }
  } catch {
    // non-JSON error body — keep the status line
  }
  return new ApiError(res.status, message, body);
}

async function request<T>(
  schema: z.ZodType<T>,
  method: "GET" | "POST",
  path: string,
  init: { body?: unknown } & RequestOpts,
): Promise<T> {
  const { signal, done } = withTimeout(init);
  try {
    const res = await fetch(`${config.baseUrl}${path}`, {
      method,
      ...(init.body !== undefined
        ? {
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify(init.body),
          }
        : {}),
      signal,
    });
    if (!res.ok) throw await parseError(res);
    const json: unknown = await res.json();
    return schema.parse(json);
  } finally {
    done();
  }
}

/** The full backend surface the frontend depends on. */
export interface ApiClient {
  health(opts?: RequestOpts): Promise<Health>;
  identify(query: Query, opts?: RequestOpts): Promise<ProductCard>;
  search(
    productCard: ProductCard,
    body?: { countries?: string[]; num?: number },
    opts?: RequestOpts,
  ): Promise<CandidateList>;
  fx(opts?: RequestOpts): Promise<Fx>;
  extract(
    snapshot: PageSnapshot,
    productCard: ProductCard,
    body?: { model?: string },
    opts?: RequestOpts,
  ): Promise<VerifiedFacts>;
  rank(
    facts: VerifiedFacts[],
    body?: { tableSize?: number; top?: number },
    opts?: RequestOpts,
  ): Promise<RankedResults>;
}

/** The real HTTP client against `config.baseUrl`. */
export const api: ApiClient = {
  health: (opts = {}) => request(HealthSchema, "GET", "/health", opts),

  identify: (query, opts = {}) =>
    request(ProductCardSchema, "POST", "/identify", {
      body: QuerySchema.parse(query),
      ...opts,
    }),

  search: (productCard, body = {}, opts = {}) =>
    request(CandidateListSchema, "POST", "/search", {
      body: { productCard, ...body },
      ...opts,
    }),

  fx: (opts = {}) => request(FxSchema, "GET", "/fx", opts),

  extract: (snapshot, productCard, body = {}, opts = {}) =>
    request(VerifiedFactsSchema, "POST", "/extract", {
      body: { snapshot: PageSnapshotSchema.parse(snapshot), productCard, ...body },
      ...opts,
    }),

  rank: (facts, body = {}, opts = {}) =>
    request(RankedResultsSchema, "POST", "/rank", {
      body: { facts, ...body },
      ...opts,
    }),
};
