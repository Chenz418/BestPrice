import { SearchError } from "./serp/types.ts";

/**
 * Currency conversion to EUR (part of B.3).
 *
 * Uses Frankfurter (https://frankfurter.dev) — free, no key, ECB reference
 * rates, EUR-based — which fits the EU-focused prototype. Rates map a currency
 * code to "units of that currency per 1 EUR", so: eur = amount / rate.
 */
export type Rates = Record<string, number>;

/** Fetch latest EUR-based reference rates. */
export async function fetchEurRates(): Promise<Rates> {
  const url = "https://api.frankfurter.dev/v1/latest?base=EUR";
  let res: Response;
  try {
    res = await fetch(url);
  } catch (cause) {
    throw new SearchError(`Network error fetching FX rates: ${String(cause)}`);
  }
  if (!res.ok) {
    throw new SearchError(`FX provider returned ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { base?: string; rates?: Rates };
  if (!body.rates) throw new SearchError("FX provider returned no rates.");
  // Frankfurter omits the base itself from `rates`; add EUR:1 for convenience.
  return { EUR: 1, ...body.rates };
}

/**
 * Convert `amount` in `currency` to EUR using `rates`. Returns null when the
 * currency is unknown, so callers can drop/flag rather than fabricate a price.
 */
export function toEur(
  amount: number,
  currency: string,
  rates: Rates,
): number | null {
  const code = currency.toUpperCase();
  if (code === "EUR") return round2(amount);
  const rate = rates[code];
  if (!rate || rate <= 0) return null;
  return round2(amount / rate);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
