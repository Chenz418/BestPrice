/**
 * Minimal ambient typings for the subset of the Chrome extension API the frontend
 * uses. We deliberately avoid a dependency on `@types/chrome` to keep the prototype
 * installable offline; extend this file as new APIs are needed.
 */

interface ChromeTab {
  id?: number;
  url?: string;
  status?: string;
}

interface ChromeTabChangeInfo {
  status?: string;
  url?: string;
}

interface ChromeInjectionResult<R> {
  result: R;
  frameId?: number;
}

interface ChromeScriptInjection<Args extends unknown[], R> {
  target: { tabId: number; allFrames?: boolean };
  func: (...args: Args) => R;
  args?: Args;
  world?: "ISOLATED" | "MAIN";
}

interface ChromeEvent<L extends (...args: never[]) => unknown> {
  addListener(listener: L): void;
  removeListener(listener: L): void;
  hasListener(listener: L): boolean;
}

interface ChromeApi {
  runtime: {
    lastError?: { message?: string };
    onInstalled: ChromeEvent<() => void>;
    onMessage: ChromeEvent<
      (
        message: unknown,
        sender: unknown,
        sendResponse: (response?: unknown) => void,
      ) => boolean | undefined | void
    >;
    sendMessage(message: unknown): Promise<unknown>;
  };
  tabs: {
    create(props: { url: string; active?: boolean }): Promise<ChromeTab>;
    remove(tabId: number): Promise<void>;
    onUpdated: ChromeEvent<
      (tabId: number, changeInfo: ChromeTabChangeInfo, tab: ChromeTab) => void
    >;
  };
  scripting: {
    executeScript<Args extends unknown[], R>(
      injection: ChromeScriptInjection<Args, R>,
    ): Promise<Array<ChromeInjectionResult<R>>>;
  };
  sidePanel: {
    setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void>;
  };
  storage: {
    local: {
      get(keys: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
}

declare const chrome: ChromeApi;
