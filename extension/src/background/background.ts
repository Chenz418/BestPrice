import type { PageSnapshot } from "@bestprice/shared";
import { config } from "../config.ts";
import { extractInPage } from "../verifier/extractInPage.ts";
import type {
  InPageResult,
  VerifyCtx,
  VerifyPageMessage,
  VerifyPageResponse,
  VerifyPageResult,
} from "../verifier/types.ts";
import type { SearchCandidate } from "@bestprice/shared";

/**
 * Background service worker: the only place that opens shop pages. It opens each
 * candidate in a background tab, waits for load, injects `extractInPage`, builds a
 * `PageSnapshot` (the exact shape /extract consumes), and closes the tab. A server
 * IP would be blocked and lack the user's locale/cookies — which is why this lives
 * in the extension, not the backend.
 */

// Clicking the toolbar icon opens the side panel.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

/** Shipping-info page text cached per shop host (reused across its candidates). */
const shopShippingCache = new Map<string, string>();

/**
 * Common shipping/delivery info paths, tried (in order) when the product page
 * exposed no shipping link. Covers the major EU languages and the usual CMS
 * conventions (Shopify `/pages/...`, generic `/shipping`, help-centre paths).
 */
const SHIPPING_PATH_GUESSES = [
  "/shipping",
  "/delivery",
  "/shipping-and-returns",
  "/pages/shipping-policy",
  "/spedizioni",
  "/consegna",
  "/versand",
  "/livraison",
  "/envios",
];

/** Does this text actually read like shipping/delivery info (not a 404/home page)? */
function looksLikeShipping(text: string): boolean {
  return /shipping|delivery|versand|lieferung|livraison|spedizion|consegna|env[ií]o|verzend|leverans|dostawa/i.test(
    text,
  );
}

/**
 * Find the shop's shipping-info text: first any links the product page surfaced,
 * then a bounded set of guessed paths. Returns the first page that reads like
 * shipping info. Bounded to keep tab churn (and CAPTCHA exposure) low.
 */
async function fetchShippingText(
  productUrl: string,
  foundLinks: string[],
): Promise<string | null> {
  const origin = new URL(productUrl).origin;
  const guesses = SHIPPING_PATH_GUESSES.map((p) => origin + p);
  // De-duplicate while preserving order; found links are higher-signal, so first.
  const tried = new Set<string>();
  const candidates = [...foundLinks, ...guesses].filter((u) => {
    if (tried.has(u)) return false;
    tried.add(u);
    return /^https?:/i.test(u);
  });

  let attempts = 0;
  for (const url of candidates) {
    if (attempts >= 5) break; // cap total page opens per shop
    attempts++;
    const page = await openAndExtract(url);
    if (page.outcome === "ok" && page.pageText && looksLikeShipping(page.pageText)) {
      return page.pageText.slice(0, 8000);
    }
  }
  return null;
}

const EMPTY_RESULT: InPageResult = {
  outcome: "error",
  pageText: "",
  jsonLd: [],
  priceRaw: null,
  currencyRaw: null,
  title: "",
  shippingLinks: [],
};

/** Resolve once the tab reports `complete`, or after the load timeout (best effort). */
function waitForLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (updatedTabId: number, info: { status?: string }) => {
      if (updatedTabId === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(finish, timeoutMs);
  });
}

/** Open the candidate's page, extract, and always clean the tab up. */
async function openAndExtract(url: string): Promise<InPageResult> {
  let tabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    if (tabId == null) throw new Error("no tab id");
    await waitForLoad(tabId, config.pageLoadTimeoutMs);
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractInPage,
    });
    return injected[0]?.result ?? EMPTY_RESULT;
  } finally {
    if (tabId != null) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        // tab already gone
      }
    }
  }
}

async function handleVerify(
  candidate: SearchCandidate,
  ctx: VerifyCtx,
): Promise<VerifyPageResult> {
  let result: InPageResult;
  try {
    result = await openAndExtract(candidate.url);
  } catch (err) {
    result = { ...EMPTY_RESULT, title: String(err) };
  }

  // C.4 — find the shop's shipping-info page (once per shop) so /extract can
  // determine ships-to + cost + free threshold that the product page omits. Tries
  // the links on the page first, then guesses common shipping paths.
  let shippingText: string | null = null;
  if (result.outcome === "ok") {
    try {
      const host = new URL(candidate.url).host;
      const cached = shopShippingCache.get(host);
      if (cached !== undefined) {
        shippingText = cached;
      } else {
        shippingText = await fetchShippingText(candidate.url, result.shippingLinks);
        if (shippingText !== null) shopShippingCache.set(host, shippingText);
      }
    } catch {
      // shipping page is best-effort; /extract falls back to the product text
    }
  }

  const snapshot: PageSnapshot = {
    candidate,
    deliveryCountry: ctx.deliveryCountry,
    requestedSize: ctx.requestedSize,
    outcome: result.outcome,
    pageText: result.pageText,
    ...(result.jsonLd.length > 0 ? { structuredData: result.jsonLd } : {}),
    shippingText,
    fetchedAt: new Date().toISOString(),
  };

  return { snapshot, priceRaw: result.priceRaw, currencyRaw: result.currencyRaw };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as Partial<VerifyPageMessage> | null;
  if (msg?.type === "VERIFY_PAGE" && msg.candidate && msg.ctx) {
    handleVerify(msg.candidate, msg.ctx)
      .then((result) => sendResponse({ ok: true, result } satisfies VerifyPageResponse))
      .catch((err) =>
        sendResponse({ ok: false, error: String(err?.message ?? err) } satisfies VerifyPageResponse),
      );
    return true; // keep the message channel open for the async response
  }
  return undefined;
});
