import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "@lib/logger";

export type CopyStatus = "idle" | "success" | "failure";

interface UseCopyToClipboardOptions {
  /** Revert delay after a successful copy. Defaults to 1500 ms. */
  successMs?: number;
  /** Revert delay after a failed copy. Defaults to 2000 ms. */
  failureMs?: number;
}

// ---------------------------------------------------------------------------
// Issue #1369 — unmount-safe clipboard copy with transient feedback.
//
// Lives under @lib/runtime (not @hooks) so both feature code and legacy
// components can import it across the staged src/features boundary.
//
// Extracted from PreviewCopyButton (sprint-252) so CellDetailDialog,
// ViewStructurePanel, and ImportExportDialog stop re-implementing the same
// `navigator.clipboard.writeText` + `setCopied(true)` + timer-revert dance
// (each a subtly different copy that could drift). One hook keeps the state
// machine — carrier bind, mounted guard, single pending timer — in one place.
//
// `copy(text, key?)` writes to the clipboard, then flips `status`
// (idle -> success/failure -> idle) for `successMs` / `failureMs`. The pending
// timer is cleared on unmount and on every new copy so back-to-back clicks
// restart the window cleanly instead of setState-ing a dead component.
//
// `copiedKey` identifies WHICH item was copied for multi-button callers
// (e.g. password vs json); single-button callers omit `key` and read the
// derived `copied` boolean.
// ---------------------------------------------------------------------------

export function useCopyToClipboard<K = true>({
  successMs = 1500,
  failureMs = 2000,
}: UseCopyToClipboardOptions = {}) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const [copiedKey, setCopiedKey] = useState<K | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks mounted state so a late-resolving clipboard promise after unmount
  // doesn't call setState on a dead component.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const scheduleRevert = useCallback((ms: number) => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (mountedRef.current) {
        setStatus("idle");
        setCopiedKey(null);
      }
    }, ms);
  }, []);

  const copy = useCallback(
    async (text: string, key: K = true as K) => {
      const carrier = navigator.clipboard?.writeText?.bind(navigator.clipboard);
      if (!carrier) {
        // Carrier unavailable (insecure context, jsdom without polyfill).
        // Surface the failure path so the user is not left wondering.
        logger.error(
          "Clipboard API unavailable: navigator.clipboard.writeText is missing",
        );
        if (mountedRef.current) {
          setStatus("failure");
          setCopiedKey(null);
        }
        scheduleRevert(failureMs);
        return;
      }
      try {
        await carrier(text);
        if (mountedRef.current) {
          setStatus("success");
          setCopiedKey(key);
        }
        scheduleRevert(successMs);
      } catch (err) {
        logger.error("Clipboard writeText failed:", err);
        if (mountedRef.current) {
          setStatus("failure");
          setCopiedKey(null);
        }
        scheduleRevert(failureMs);
      }
    },
    [scheduleRevert, successMs, failureMs],
  );

  return { status, copied: status === "success", copiedKey, copy };
}
