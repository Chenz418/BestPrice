import type { SearchCandidate } from "@bestprice/shared";
import type {
  PageVerifier,
  VerifyCtx,
  VerifyPageMessage,
  VerifyPageResponse,
  VerifyPageResult,
} from "./types.ts";

/**
 * Side-panel-facing Page Verifier. Opening shop pages needs a real tab (the whole
 * point of Dev 1's verifier — user locale + cookies, never Google), which only the
 * background service worker can own. This proxy just messages the worker and
 * unwraps its response. See background/background.ts for the tab machinery.
 */
export const chromePageVerifier: PageVerifier = {
  async verify(candidate: SearchCandidate, ctx: VerifyCtx): Promise<VerifyPageResult> {
    const message: VerifyPageMessage = { type: "VERIFY_PAGE", candidate, ctx };
    const response = (await chrome.runtime.sendMessage(message)) as VerifyPageResponse;
    if (!response || !response.ok) {
      throw new Error(response?.error ?? "page verifier failed");
    }
    return response.result;
  },
};
