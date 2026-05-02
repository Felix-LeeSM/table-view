// AC-193-01 — Sprint 98 의 commit flash 동작을 useDataGridEdit 에서
// 분리한 sub-hook. 책임:
//  1. `isCommitFlashing` boolean state 관리.
//  2. `beginCommitFlash()` — 동기적으로 true 로 전환 + 400ms 안전망
//     timer 로 자동 false 복귀. 연속 호출 시 이전 timer 는 cancel 되고
//     마지막 호출의 400ms 만 active.
//  3. `clearCommitFlash()` — 외부 terminal signal (preview open / commit
//     error 등) 이 도착하면 즉시 false 로 되돌리기 위한 escape hatch.
//     facade 가 sqlPreview / mqlPreview / commitError watcher effect 에서
//     호출. contract 의 명시 인터페이스에 더해 본 hook 에서 추가
//     (Sprint 193 findings §1).
//  4. Unmount 시 pending timer drain — strict mode + tab teardown 회귀
//     테스트가 의존.
// date 2026-05-02.
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
