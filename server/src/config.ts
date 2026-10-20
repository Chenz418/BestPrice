import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";

/**
 * Loads environment variables and exposes typed config.
 *
 * Keys live in a git-ignored `.env` at the repo root (see `.env.example`).
 *
 * Precedence: the project `.env` OVERRIDES variables already set in the shell.
 * This is deliberate — it gives one authoritative place for the key, so a stale
 * value left in `~/.bashrc` cannot silently win over the `.env` you just edited.
 * (Node's built-in `loadEnvFile` does the opposite, so we parse and assign.)
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const envPath = resolve(repoRoot, ".env");

if (existsSync(envPath)) {
  const parsed = parseEnv(readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string" && value.trim().length > 0) {
      process.env[key] = value;
    }
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

export const config = {
  /** OpenAI-compatible proxy base URL (ends without a trailing slash). */
  openaiBaseUrl: optional(
    "OPENAI_BASE_URL",
    "https://apiclaude.cc/v1",
  ).replace(/\/+$/, ""),

  /** Vision-capable model used to build the product card. */
  identifyModel: optional("IDENTIFY_MODEL", "gpt-4o"),

  /** Model used by the Search API's match / normalise agents. */
  searchModel: optional("SEARCH_MODEL", "gpt-4o"),

  /** Model used by the Extract API's verification agents. */
  extractModel: optional("EXTRACT_MODEL", "gpt-4o"),

  /** Countries the Search API queries by default (comma-separated ISO2). */
  searchCountries: optional("SEARCH_COUNTRIES", "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean),

  /** HTTP port for the server. */
  port: Number(optional("PORT", "3000")),

  /** Whether a SERP key is configured (chooses live vs mock provider). */
  hasSerpKey(): boolean {
    return Boolean(process.env.SERP_API_KEY?.trim());
  },

  /** Resolve the API key lazily so the key is only needed when a call is made. */
  openaiApiKey(): string {
    return required("OPENAI_API_KEY");
  },

  /** SERP provider key, resolved lazily. */
  serpApiKey(): string {
    return required("SERP_API_KEY");
  },
};
