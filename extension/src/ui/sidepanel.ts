import type {
  ProductCard,
  Query,
  RankedOffer,
  RankedResults,
  VerifiedFacts,
} from "@bestprice/shared";
import { api } from "../api/client.ts";
import { ApiError } from "../api/client.ts";
import { config } from "../config.ts";
import {
  identify,
  searchAndRank,
  type OrchestratorDeps,
  type PipelineResult,
  type Progress,
} from "../orchestrator/orchestrator.ts";
import { chromePageVerifier } from "../verifier/pageVerifier.ts";

/**
 * Side panel controller — the only surface the user sees. Drives the A→B→C→D flow
 * through the orchestrator, renders the product card for confirmation (A.2), shows
 * live progress, and presents the ranked results.
 */

const deps: OrchestratorDeps = { api, verifier: chromePageVerifier };

const COUNTRIES = [
  "IT", "DE", "FR", "ES", "NL", "BE", "AT", "IE", "PT", "PL",
  "SE", "CZ", "RO", "GR", "FI", "DK", "HU", "SK", "HR", "SI",
];

// ---- tiny DOM helpers -------------------------------------------------------
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}
function show(id: string): void { el(id).classList.remove("hidden"); }
function hide(id: string): void { el(id).classList.add("hidden"); }
function val(id: string): string { return el<HTMLInputElement>(id).value.trim(); }

// ---- state ------------------------------------------------------------------
let currentCard: ProductCard | null = null;
let imageIndex = 0;
let runController: AbortController | null = null;

// ---- settings ---------------------------------------------------------------
async function loadSettings(): Promise<void> {
  const select = el<HTMLSelectElement>("in-country");
  select.innerHTML = COUNTRIES.map((c) => `<option value="${c}">${c}</option>`).join("");
  const stored = await chrome.storage.local.get("deliveryCountry");
  const country = (stored.deliveryCountry as string) || config.defaultDeliveryCountry;
  select.value = COUNTRIES.includes(country) ? country : config.defaultDeliveryCountry;
}

// ---- error toast ------------------------------------------------------------
function toast(message: string): void {
  const t = el("error-toast");
  t.textContent = message;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 6000);
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return "Can't reach the backend — is it running on localhost:3000?";
    return `Backend error (${err.status}): ${err.message}`;
  }
  if (err instanceof DOMException && err.name === "AbortError") return "Cancelled.";
  if (err instanceof TypeError) return "Network error — is the backend running on localhost:3000?";
  return err instanceof Error ? err.message : String(err);
}

// ---- A. Identify ------------------------------------------------------------
function buildQuery(): Query {
  const size = val("in-size");
  const deliveryCountry = el<HTMLSelectElement>("in-country").value;
  if (!size) throw new Error("Size is required.");
  if (!deliveryCountry) throw new Error("Delivery country is required.");

  const q: Query = { size, deliveryCountry };
  const name = val("in-name");
  const code = val("in-code");
  const message = val("in-message");
  const image = val("in-image");
  if (name) q.productName = name;
  if (code) q.productCode = code;
  if (message) q.message = message;
  if (image) q.image = { url: image };
  if (!name && !code && !message && !image) {
    throw new Error("Give at least one of: product name, code, note, or image.");
  }
  return q;
}

async function onIdentify(): Promise<void> {
  let query: Query;
  try {
    query = buildQuery();
  } catch (err) {
    toast(describeError(err));
    return;
  }
  const btn = el<HTMLButtonElement>("btn-identify");
  btn.disabled = true;
  btn.textContent = "Identifying…";
  try {
    currentCard = await identify(deps, query);
    imageIndex = 0;
    renderCard(currentCard);
    hide("input-section");
    show("card-section");
  } catch (err) {
    toast(describeError(err));
  } finally {
    btn.disabled = false;
    btn.textContent = "Identify →";
  }
}

// ---- A.2 Card confirmation --------------------------------------------------
const EDITABLE: Array<{ key: keyof ProductCard; label: string }> = [
  { key: "brand", label: "Brand" },
  { key: "model", label: "Model" },
  { key: "colour", label: "Colour" },
  { key: "styleCode", label: "Style code" },
  { key: "category", label: "Category" },
  { key: "sizeSystem", label: "Size system" },
  { key: "requestedSize", label: "Your size" },
];

function renderCard(card: ProductCard): void {
  // Editable identifying fields.
  const fields = el("card-fields");
  fields.innerHTML = "";
  for (const { key, label } of EDITABLE) {
    const value = card[key];
    const wrap = document.createElement("label");
    wrap.textContent = label;
    const input = document.createElement("input");
    input.type = "text";
    input.value = typeof value === "string" ? value : "";
    input.addEventListener("input", () => {
      const v = input.value.trim();
      // Re-assign through a typed cast; all editable fields are `string | null`.
      (card as Record<string, unknown>)[key as string] = v === "" ? null : v;
    });
    wrap.appendChild(input);
    fields.appendChild(wrap);
  }

  // Search queries (read-only) help the user sanity-check the identification.
  if (card.searchQueries.length > 0) {
    const sq = document.createElement("p");
    sq.className = "notes";
    sq.textContent = "Queries: " + card.searchQueries.map((q) => `${q.lang}: ${q.query}`).join(" · ");
    fields.appendChild(sq);
  }

  el("card-notes").textContent = card.notes ?? "";
  renderImage(card);
}

function renderImage(card: ProductCard): void {
  const candidates = card.representativeImageCandidates ?? [];
  const img = el<HTMLImageElement>("card-image");
  const badge = el("card-image-confidence");
  const refind = el<HTMLButtonElement>("btn-refind");

  const chosen = candidates[imageIndex];
  const url = chosen?.imageUrl ?? card.representativeImageUrl ?? "";
  const confidence = chosen?.confidence ?? card.representativeImageConfidence ?? null;

  img.src = url;
  img.style.visibility = url ? "visible" : "hidden";
  badge.textContent = confidence ? `image: ${confidence}` : "no image";
  badge.className = "badge" + (confidence ? ` ${confidence}` : "");
  refind.style.display = candidates.length > 1 ? "inline" : "none";
}

function onRefind(): void {
  if (!currentCard) return;
  const n = currentCard.representativeImageCandidates?.length ?? 0;
  if (n === 0) return;
  imageIndex = (imageIndex + 1) % n;
  // Keep the card's representative image in sync with the user's choice.
  const chosen = currentCard.representativeImageCandidates?.[imageIndex];
  if (chosen) {
    currentCard.representativeImageUrl = chosen.imageUrl;
    currentCard.representativeImageSource = chosen.sourceUrl;
    currentCard.representativeImageConfidence = chosen.confidence;
  }
  renderImage(currentCard);
}

// ---- B→C→D run --------------------------------------------------------------
function renderProgress(p: Progress): void {
  const line = el("progress-line");
  const bar = el<HTMLDivElement>("progress-bar");
  switch (p.phase) {
    case "identify": line.textContent = "Identifying…"; bar.style.width = "5%"; break;
    case "search": line.textContent = "Searching shops across countries…"; bar.style.width = "15%"; break;
    case "verify":
      line.textContent = `Verifying every candidate… ${p.verified}/${p.total} · ${p.qualified} qualify`;
      bar.style.width = `${15 + Math.round((p.verified / Math.max(1, p.total)) * 80)}%`;
      break;
    case "rank": line.textContent = "Ranking…"; bar.style.width = "95%"; break;
    case "done": line.textContent = "Done."; bar.style.width = "100%"; break;
  }
}

async function onSearch(): Promise<void> {
  if (!currentCard) return;
  const deliveryCountry = el<HTMLSelectElement>("in-country").value;
  runController = new AbortController();

  hide("card-section");
  show("progress-section");
  el<HTMLDivElement>("progress-bar").style.width = "0";

  try {
    const out: PipelineResult = await searchAndRank(deps, currentCard, {
      deliveryCountry,
      onProgress: renderProgress,
      signal: runController.signal,
    });
    renderResults(out);
    hide("progress-section");
    show("results-section");
  } catch (err) {
    hide("progress-section");
    show("card-section");
    toast(describeError(err));
  } finally {
    runController = null;
  }
}

function onCancel(): void {
  runController?.abort();
}

// ---- D. Results -------------------------------------------------------------
const fmtEur = (n: number | null): string => (n == null ? "—" : `€${n.toFixed(2)}`);

/**
 * One offer card. Ranked offers are shown by BEST PRICE even when not fully
 * verified; `missing` labels say exactly what couldn't be confirmed so the price
 * stays honest (e.g. a "+" marks a total that excludes an unknown shipping cost).
 */
function offerCard(offer: RankedOffer, top: boolean): string {
  const ship =
    offer.shippingCostEur == null
      ? offer.shipsTo === true
        ? "free/included"
        : "unknown"
      : offer.shippingCostEur === 0
        ? "free"
        : fmtEur(offer.shippingCostEur);

  // Guaranteed total when known; otherwise the item price with a "+" (shipping TBD).
  const priceLabel =
    offer.guaranteedTotalEur != null
      ? fmtEur(offer.guaranteedTotalEur)
      : `${fmtEur(offer.itemPriceEur)}+`;

  const labels =
    offer.missing.length > 0
      ? `<div class="labels">${offer.missing
          .map((m) => `<span class="label label-warn">${escapeHtml(m)}</span>`)
          .join("")}</div>`
      : `<div class="labels"><span class="label label-ok">fully verified</span></div>`;

  const savings =
    offer.possibleExtraSavings.length > 0
      ? `<div class="savings">Possible extra savings: ${offer.possibleExtraSavings
          .map(escapeHtml)
          .join("; ")}</div>`
      : "";

  return `
    <div class="offer ${top ? "top" : ""}">
      <div class="offer-head">
        <span class="offer-shop">${escapeHtml(offer.shop)} · ${offer.country}</span>
        <span class="offer-total">${priceLabel}</span>
      </div>
      <div class="offer-meta">item ${fmtEur(offer.itemPriceEur)} + shipping ${ship}</div>
      ${labels}
      ${savings}
      <a href="${escapeHtml(offer.url)}" target="_blank" rel="noreferrer">${escapeHtml(offer.url)}</a>
    </div>`;
}

/** A muted row for a page we couldn't read at all (CAPTCHA / login / blocked). */
function couldntRow(f: VerifiedFacts): string {
  return `
    <div class="offer muted">
      <div class="offer-head">
        <span class="offer-shop">${escapeHtml(f.shop)} · ${f.country}</span>
        <span class="label label-low">couldn't read (${escapeHtml(f.couldntVerifyReason ?? "error")})</span>
      </div>
      <a href="${escapeHtml(f.url)}" target="_blank" rel="noreferrer">${escapeHtml(f.url)}</a>
    </div>`;
}

function renderResults(out: PipelineResult): void {
  const r: RankedResults = out.results;
  const container = el("results");
  const parts: string[] = [];

  // Top N best-price matching products (verified AND partially-verified).
  if (r.top5.length === 0) {
    parts.push(
      `<p class="notes">No matching product with a confirmed price was found${
        r.couldntVerify.length > 0 ? ` — ${r.couldntVerify.length} page(s) couldn't be read` : ""
      }.</p>`,
    );
  } else {
    parts.push(`<div class="bucket-title">Top ${r.top5.length} — best price</div>`);
    r.top5.forEach((o, i) => parts.push(offerCard(o, i === 0)));
  }

  // The other matching products, same ranking, kept as candidates.
  if (r.candidates.length > 0) {
    parts.push(`<div class="bucket-title">Other candidates (${r.candidates.length})</div>`);
    r.candidates.forEach((o) => parts.push(offerCard(o, false)));
  }

  // Pages we couldn't read at all.
  if (r.couldntVerify.length > 0) {
    parts.push(`<div class="bucket-title">Couldn't read (${r.couldntVerify.length})</div>`);
    r.couldntVerify.forEach((f) => parts.push(couldntRow(f)));
  }

  container.innerHTML = parts.join("");
  renderCoverage(out);
}

function renderCoverage(out: PipelineResult): void {
  const node = el("coverage");
  const meta = out.listMeta;
  const stats = out.results.stats;
  const bits: string[] = [];
  if (meta.countriesSearched.length > 0) {
    bits.push(`Searched: ${meta.countriesSearched.join(", ")}`);
  }
  const cov = meta.coverage;
  if (cov && cov.substituted.length > 0) {
    bits.push(
      "Substituted: " +
        cov.substituted.map((s) => `${s.requested}→${s.searchedVia}`).join(", "),
    );
  }
  if (cov && cov.unsupported.length > 0) {
    bits.push(`Not searched: ${cov.unsupported.join(", ")}`);
  }
  const note =
    out.totalCandidates > out.facts.length
      ? `, checked ${out.facts.length} of ${out.totalCandidates}`
      : "";
  bits.push(
    `${stats.matches} match${stats.matches === 1 ? "" : "es"} · ${stats.fullyVerified} fully verified${note}`,
  );
  node.textContent = bits.join(" · ");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

// ---- navigation -------------------------------------------------------------
function restart(): void {
  currentCard = null;
  imageIndex = 0;
  hide("results-section");
  hide("card-section");
  hide("progress-section");
  show("input-section");
}

// ---- wire-up ----------------------------------------------------------------
function main(): void {
  void loadSettings();
  el("btn-identify").addEventListener("click", () => void onIdentify());
  el("btn-refind").addEventListener("click", onRefind);
  el("btn-search").addEventListener("click", () => void onSearch());
  el("btn-cancel").addEventListener("click", onCancel);
  el("btn-back").addEventListener("click", () => { hide("card-section"); show("input-section"); });
  el("btn-restart").addEventListener("click", restart);

  // Persist the delivery country whenever it changes.
  el<HTMLSelectElement>("in-country").addEventListener("change", (e) => {
    const country = (e.target as HTMLSelectElement).value;
    void chrome.storage.local.set({ deliveryCountry: country });
  });
}

main();
