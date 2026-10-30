/**
 * Frontend configuration. The backend base URL must match a `host_permissions`
 * entry in manifest.json, or cross-origin fetches from the side panel are blocked.
 */
export const config = {
  /** Backend base URL (see manifest host_permissions). */
  baseUrl: "http://localhost:3000",

  /** Verify loop (plan C): cheapest batch size and how many pages open at once. */
  batchSize: 15,
  verifyConcurrency: 3,

  /** C.0 price pre-sort: how many pages to peek concurrently. */
  peekConcurrency: 4,

  /** Stop the verify loop once this many offers qualify (plan D, Top N). */
  target: 5,

  /** Per-request timeout for backend calls (ms). Each hits an LLM / SERP / FX. */
  requestTimeoutMs: 60000,

  /** Longer timeout for /extract — it can make two LLM calls (product + shipping). */
  extractTimeoutMs: 90000,

  /** How long to wait for a shop page to load before extracting (ms). */
  pageLoadTimeoutMs: 20000,

  /** Default delivery country if the user hasn't set one. */
  defaultDeliveryCountry: "IT",
} as const;
