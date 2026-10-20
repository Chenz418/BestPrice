import { langForCountry } from "../search/countries.ts";
import type { PageVerifier } from "./verifyAndRank.ts";

/**
 * Server-side HTTP page verifier (plan C.1 / C.6).
 *
 * NOTE ON OWNERSHIP: in production, opening pages is the extension's Page verifier
 * (Dev 1) — a real browser handles JS, cookies, the user's locale, and CAPTCHAs.
 * This server-side fetcher exists so the backend can be driven end-to-end on its
 * own (and for tests). Because it uses a datacenter IP and no JS engine, many real
 * shops will return CAPTCHA / blocked — which the loop correctly reports as
 * "couldn't verify". That is expected and is exactly why the browser verifier
 * exists; don't read a high couldn't-verify rate here as a bug.
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface HttpVerifierOptions {
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** Max characters of extracted page text to keep. */
  maxTextChars?: number;
}

function acceptLanguage(country: string): string {
  const lang = langForCountry(country);
  return lang === "en" ? "en" : `${lang},en;q=0.8`;
}

/** Decide the snapshot outcome from the HTTP status and body markers (C.6). */
function classifyOutcome(
  status: number,
  lowerBody: string,
): "ok" | "captcha" | "login_wall" | "blocked" | "error" {
  if (status === 403 || status === 429) return "blocked";
  if (status >= 400) return "error";

  const captcha = [
    "captcha",
    "just a moment",
    "cf-chl",
    "cf-challenge",
    "recaptcha",
    "px-captcha",
    "are you a human",
    "verify you are human",
  ];
  if (captcha.some((m) => lowerBody.includes(m))) return "captcha";

  const login = ["sign in to continue", "please log in to", "enter your password"];
  if (login.some((m) => lowerBody.includes(m))) return "login_wall";

  return "ok";
}

/** Strip HTML to readable text. */
function htmlToText(html: string, maxChars: number): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&euro;/gi, "€")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

/** Collect JSON-LD blocks (schema.org Product gives price/stock/size — C.3). */
function extractJsonLd(html: string): unknown[] | undefined {
  const out: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      out.push(JSON.parse(m[1]!.trim()));
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return out.length > 0 ? out : undefined;
}

/** Create a PageVerifier that fetches shop pages over HTTP. */
export function createHttpPageVerifier(opts: HttpVerifierOptions = {}): PageVerifier {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const maxTextChars = opts.maxTextChars ?? 20000;

  return async (candidate, ctx) => {
    const base = {
      candidate,
      deliveryCountry: ctx.deliveryCountry,
      requestedSize: ctx.requestedSize,
      fetchedAt: new Date().toISOString(),
      shippingText: null,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    let html: string;
    try {
      res = await fetch(candidate.url, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": acceptLanguage(ctx.deliveryCountry),
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      html = await res.text();
    } catch {
      clearTimeout(timer);
      return { ...base, outcome: "error" as const, pageText: "" };
    }
    clearTimeout(timer);

    const outcome = classifyOutcome(res.status, html.toLowerCase());
    if (outcome !== "ok") {
      return { ...base, outcome, pageText: "" };
    }
    return {
      ...base,
      outcome,
      pageText: htmlToText(html, maxTextChars),
      ...(extractJsonLd(html) ? { structuredData: extractJsonLd(html) } : {}),
    };
  };
}

/** Default HTTP verifier instance. */
export const httpPageVerifier: PageVerifier = createHttpPageVerifier();
