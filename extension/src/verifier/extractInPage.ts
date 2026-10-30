import type { InPageResult } from "./types.ts";

/**
 * Runs INSIDE the shop page (injected via chrome.scripting.executeScript). Must be
 * fully self-contained — only the function body is serialised into the page.
 *
 * Gathers the evidence the backend LLM needs that a product page often hides:
 *   - price (JSON-LD offers.price, meta fallback)                        (C.2)
 *   - per-size availability: JSON-LD offers[], DOM size pickers, AND one
 *     best-effort interaction (open the size control, re-scan)          (C.3)
 *   - links to the shop's shipping/delivery info page                   (C.4)
 *   - CAPTCHA / login classification                                    (C.6)
 * It is async because the size-control interaction waits for the panel to open.
 */
export async function extractInPage(): Promise<InPageResult> {
  const empty: InPageResult = {
    outcome: "error",
    pageText: "",
    jsonLd: [],
    priceRaw: null,
    currencyRaw: null,
    title: "",
    shippingLinks: [],
  };
  try {
    const title = document.title || "";
    const hay = (title + " " + (document.body?.innerText || "").slice(0, 200000)).toLowerCase();

    // --- C.6: blocked / CAPTCHA / login. -----------------------------------
    const captcha = [
      "captcha", "just a moment", "cf-chl", "recaptcha", "px-captcha",
      "are you a human", "verify you are human", "enable javascript and cookies to continue",
    ];
    const login = ["sign in to continue", "please log in to", "enter your password"];
    let outcome: InPageResult["outcome"] = "ok";
    if (captcha.some((m) => hay.includes(m))) outcome = "captcha";
    else if (login.some((m) => hay.includes(m))) outcome = "login_wall";

    // --- JSON-LD blocks. ---------------------------------------------------
    const jsonLd: unknown[] = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((n) => {
      try { jsonLd.push(JSON.parse(n.textContent || "")); } catch { /* ignore */ }
    });

    // --- Price from a JSON-LD offer (recursive). ---------------------------
    const findOffer = (node: unknown): { price: number; currency: string | null } | null => {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node)) {
        for (const x of node) { const r = findOffer(x); if (r) return r; }
        return null;
      }
      const obj = node as Record<string, unknown>;
      const readPrice = (o: Record<string, unknown>) => {
        if (o.price != null) {
          const p = parseFloat(String(o.price).replace(",", "."));
          if (!Number.isNaN(p)) return { price: p, currency: typeof o.priceCurrency === "string" ? o.priceCurrency : null };
        }
        return null;
      };
      const offers = obj.offers;
      if (offers) {
        for (const raw of Array.isArray(offers) ? offers : [offers]) {
          if (raw && typeof raw === "object") {
            const o = raw as Record<string, unknown>;
            const direct = readPrice(o);
            if (direct) return direct;
            const ps = o.priceSpecification;
            if (ps && typeof ps === "object") {
              const fromSpec = readPrice(ps as Record<string, unknown>);
              if (fromSpec) return fromSpec;
            }
          }
        }
      }
      for (const k of Object.keys(obj)) { const r = findOffer(obj[k]); if (r) return r; }
      return null;
    };
    let priceRaw: number | null = null;
    let currencyRaw: string | null = null;
    for (const block of jsonLd) {
      const found = findOffer(block);
      if (found) { priceRaw = found.price; currencyRaw = found.currency; break; }
    }
    if (priceRaw == null) {
      const meta = (sel: string) => document.querySelector(sel)?.getAttribute("content") ?? null;
      const pStr = meta('meta[itemprop="price"], meta[property="product:price:amount"], meta[property="og:price:amount"]');
      if (pStr) { const p = parseFloat(pStr.replace(",", ".")); if (!Number.isNaN(p)) priceRaw = p; }
      currencyRaw = meta('meta[itemprop="priceCurrency"], meta[property="product:price:currency"], meta[property="og:price:currency"]');
    }

    // --- Size / stock (C.3): structured, DOM, then one interaction. --------
    const UNAVAIL = /sold\s*out|out of stock|unavailable|non dispon|épuisé|ausverkauft|esaurito|agotado|niedost|slut|coming soon/i;
    const AVAIL_LD = /InStock|LimitedAvailability|PreOrder|BackOrder/i;
    const seen = new Set<string>();
    const signals: string[] = [];
    const push = (label: string, unavailable: boolean) => {
      const t = label.trim();
      if (!t || t.length > 24 || seen.has(t)) return;
      seen.add(t);
      signals.push(unavailable ? `${t} [unavailable]` : `${t} [available]`);
    };

    // (1) JSON-LD offers[] — each size often a separate offer with availability.
    const walkLdSizes = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(walkLdSizes); return; }
      const o = node as Record<string, unknown>;
      const offers = o.offers;
      if (Array.isArray(offers)) {
        for (const raw of offers) {
          if (raw && typeof raw === "object") {
            const of = raw as Record<string, unknown>;
            const label = String(of.name ?? of.sku ?? of.size ?? "").trim();
            const avail = String(of.availability ?? "");
            if (label) push(label, avail ? !AVAIL_LD.test(avail) : false);
          }
        }
      }
      for (const k of Object.keys(o)) walkLdSizes(o[k]);
    };
    jsonLd.forEach(walkLdSizes);

    // (2) DOM size pickers (native selects + button/swatch grids).
    const scanDom = (): void => {
      document.querySelectorAll("select").forEach((sel) => {
        sel.querySelectorAll("option").forEach((op) => {
          const t = (op.textContent || "").trim();
          if (t) push(t, op.hasAttribute("disabled") || UNAVAIL.test(t));
        });
      });
      document
        .querySelectorAll('[class*="size" i] button, [class*="size" i] li, [class*="swatch" i] button, [data-size], [role="radio"], [aria-label*="size" i]')
        .forEach((el) => {
          const t = (el.textContent || "").trim();
          if (!t) return;
          const cls = (el.getAttribute("class") || "").toLowerCase();
          const bad = el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true" ||
            /disabled|sold|out-?of|unavailable|soldout|crossed/.test(cls) || UNAVAIL.test(t);
          push(t, bad);
        });
    };
    scanDom();

    // (3) Interaction: open a likely size control, wait, re-scan. Guarded so a
    // navigation or failure never breaks extraction.
    try {
      const SIZE_RE = /\b(size|taille|größe|grösse|groesse|taglia|talla|storlek|rozmiar)\b/i;
      const triggers = Array.from(document.querySelectorAll('button,[role="button"],[aria-haspopup],summary'))
        .filter((el) => SIZE_RE.test((el.getAttribute("aria-label") || "") + " " + (el.textContent || "").slice(0, 40)))
        .slice(0, 2) as HTMLElement[];
      if (triggers.length > 0) {
        const startUrl = location.href;
        for (const t of triggers) { try { t.click(); } catch { /* ignore */ } }
        await new Promise((r) => setTimeout(r, 500));
        if (location.href === startUrl) scanDom(); // re-read only if we didn't navigate
      }
    } catch { /* interaction is best-effort */ }

    if (signals.length > 0) jsonLd.push({ _sizeStockSignals: signals.slice(0, 80) });

    // --- Shipping / delivery info links (C.4). -----------------------------
    const SHIP_RE = /shipping|delivery|versand|lieferung|livraison|spedizion|consegna|envío|envio|verzend|leverans|dostawa|returns?-?and-?shipping/i;
    const shippingLinks: string[] = [];
    const seenLinks = new Set<string>();
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = (a as HTMLAnchorElement).href;
      const text = (a.textContent || "") + " " + href;
      if (href && SHIP_RE.test(text) && !seenLinks.has(href) && /^https?:/i.test(href)) {
        seenLinks.add(href);
        if (shippingLinks.length < 4) shippingLinks.push(href);
      }
    });

    // --- Main product text (bounded). --------------------------------------
    const main =
      (document.querySelector("main") as HTMLElement | null) ||
      (document.querySelector('[itemtype*="Product"]') as HTMLElement | null) ||
      document.body;
    const pageText = (main?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 20000);

    return { outcome, pageText, jsonLd, priceRaw, currencyRaw, title, shippingLinks };
  } catch {
    return empty;
  }
}
