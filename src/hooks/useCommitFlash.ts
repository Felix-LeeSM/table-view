// Commit-flash sub-hook for the data grid. Owns:
//  1. The `isCommitFlashing` boolean.
//  2. `beginCommitFlash()` — synchronous true + 400ms safety timer that
//     auto-resets. Successive calls cancel the previous timer.
//  3. `clearCommitFlash()` — escape hatch for terminal signals (preview
//     opened / commit error). Called by the facade's watcher effect.
//  4. Unmount drain — keeps strict-mode + tab teardown clean.
import { useCallback, useEffect, useRef, useState } from "react";

const COMMIT_FLASH_SAFETY_MS = 400;

export interface UseCommitFlashReturn {
  isCommitFlashing: boolean;
  beginCommitFlash(): void;
  clearCommitFlash(): void;
}

export function useCommitFlash(): UseCommitFlashReturn {
  const [isCommitFlashing, setIsCommitFlashing] = useState(false);
  // Ref so subsequent flashes can clear the previous safety timer without
  // a re-render — and so unmount cleanup can drain a pending timer
  // without racing the watcher effect.
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelTimer = useCallback(() => {
    if (flashTimeoutRef.current !== null) {
      clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = null;
    }
  }, []);

  const beginCommitFlash = useCallback(() => {
    setIsCommitFlashing(true);
    cancelTimer();
    flashTimeoutRef.current = setTimeout(() => {
      setIsCommitFlashing(false);
      flashTimeoutRef.current = null;
    }, COMMIT_FLASH_SAFETY_MS);
  }, [cancelTimer]);

  const clearCommitFlash = useCallback(() => {
    setIsCommitFlashing(false);
    cancelTimer();
  }, [cancelTimer]);

  // Drain any pending safety timer on unmount so a tab teardown can never
  // schedule a setState on an unmounted hook (React 18 strict mode + the
  // existing `removes the listener on unmount` regression test both rely
  // on this being clean).
  useEffect(() => {
    return () => {
      cancelTimer();
    };
  }, [cancelTimer]);

  return { isCommitFlashing, beginCommitFlash, clearCommitFlash };
}
