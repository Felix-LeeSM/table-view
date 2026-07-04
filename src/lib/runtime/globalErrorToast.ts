import { toast } from "@lib/runtime/toast";
import { logger } from "@lib/logger";
import i18n from "@lib/i18n";

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
