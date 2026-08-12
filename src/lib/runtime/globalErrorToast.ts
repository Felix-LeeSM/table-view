import i18n from "@lib/i18n";
import { logger } from "@lib/logger";
import { toast } from "@lib/runtime/toast";

/**
 * Last-resort safety net for failures that never reach a React ErrorBoundary
 * (#1312):
 *
 *   - `unhandledrejection` — an async/IPC promise that rejects with no
 *     `.catch`, which would otherwise vanish silently.
 *   - `error` — an uncaught synchronous throw. Notably the react-dom *dev*
 *     commit-phase logging throw (e.g. `JSON.stringify` on a BigInt prop)
 *     escapes every boundary and freezes the app; surfacing a toast at least
 *     tells the user something broke instead of a silent hang.
 *
 * We de-dupe identical messages inside a short window because React re-throws
 * a boundary-caught error to `window` in dev, which would otherwise
 * double-toast the same failure.
 */
const DEDUPE_WINDOW_MS = 3000;

/**
 * Not a failure: the ResizeObserver spec has the user agent report this on
 * `window` when a callback resizes something and the remaining observations
 * spill into the next frame. Anything that measures with a ResizeObserver and
 * stores the result can raise it — the single observer React Flow shares across
 * its nodes (`useResizeObserver` builds one and `NodeRenderer` hands it to every
 * `NodeWrapper` to `observe()`), the virtualized grids (`DataGridTable`,
 * `DocumentDataGrid`), the schema trees — so this bridge is the one place that
 * can drop it for all of them instead of each surface fighting its own observer.
 *
 * Dropping it costs the record, not just the toast: `logger.warn` is a no-op
 * outside `pnpm dev` (`src/lib/logger.ts`), so a packaged build keeps no trace
 * that a report arrived. `docs/product/known-limitations.md` owns that boundary.
 *
 * Anchored at the start because only the loop report is benign; a real throw
 * that merely names ResizeObserver still has to reach the user. Both wordings
 * are covered: WebKit and current Chromium say "loop completed with
 * undelivered notifications", older Chromium says "loop limit exceeded".
 */
const RESIZE_OBSERVER_LOOP_REPORT = /^ResizeObserver loop/;

function extractMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  try {
    return String(reason);
  } catch {
    return "unknown error";
  }
}

export function installGlobalErrorToast(): () => void {
  let lastMessage = "";
  let lastAt = 0;

  const surface = (message: string) => {
    if (RESIZE_OBSERVER_LOOP_REPORT.test(message)) {
      logger.warn("[global-error] ignored resize-observer report:", message);
      return;
    }
    const now = Date.now();
    if (message === lastMessage && now - lastAt < DEDUPE_WINDOW_MS) return;
    lastMessage = message;
    lastAt = now;
    logger.error("[global-error] surfaced to toast:", message);
    toast.error(i18n.t("shared:asyncError", { message }));
  };

  const onRejection = (e: PromiseRejectionEvent) => {
    surface(extractMessage(e.reason));
  };
  const onError = (e: ErrorEvent) => {
    surface(extractMessage(e.error ?? e.message));
  };

  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("error", onError);
  return () => {
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("error", onError);
  };
}
