import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mapSerpApiResponse } from "./serpapi.ts";
import type { RawSerpResult } from "./types.ts";
import type { SerpProvider } from "./provider.ts";

/**
 * Fixture-backed SERP provider for offline development (plan: "Dev 2 tests
 * extraction on saved pages without a browser ... avoid paying for API calls").
 *
 * It reads `scripts/fixtures/serp/<COUNTRY>.json` — a saved raw SerpApi response
 * — and maps it through the SAME adapter the live provider uses, so the mock
 * exercises the real normalisation path. Countries without a fixture return [].
 */
const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "..", "..", "..", "scripts", "fixtures", "serp");

export const mockSerpProvider: SerpProvider = async (
  _query: string,
  country: string,
): Promise<RawSerpResult[]> => {
  const file = resolve(fixturesDir, `${country.toUpperCase()}.json`);
  if (!existsSync(file)) return [];
  const body = JSON.parse(readFileSync(file, "utf8")) as Parameters<
    typeof mapSerpApiResponse
  >[0];
  return mapSerpApiResponse(body, country.toUpperCase());
};
