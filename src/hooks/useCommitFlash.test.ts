// AC-193-01 — `useCommitFlash` sub-hook 단위 테스트. Sprint 193 의
// useDataGridEdit god-surface 분해 1단계로, Sprint 98 의 commit flash
// (Cmd+S 누른 직후 즉시 가시화 + 400ms 안전망) 동작을 facade 에서
// 분리해 hook 단으로 옮긴 책임을 직접 단언한다. 기존
// `useDataGridEdit.commit-shortcut.test.ts` 가 통합 단언을 보존하지만,
// 본 테스트는 hook 의 4 가지 분기 (초기 / 동기 set / safety expiry /
// 연속 호출 cancel) 를 hook 단위로 고정한다.
// date 2026-05-02.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCommitFlash } from "./useCommitFlash";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCommitFlash", () => {
  // [AC-193-01-1] 초기 isCommitFlashing 은 false. 평시 toolbar 가
  // spinner 를 띄우지 않는다는 baseline 단언.
  // date 2026-05-02
  it("[AC-193-01-1] initial isCommitFlashing is false", () => {
    const { result } = renderHook(() => useCommitFlash());
    expect(result.current.isCommitFlashing).toBe(false);
  });

  // [AC-193-01-2] beginCommitFlash() 는 동기적으로 true 로 전환. AC-01
  // 의 200ms 시각 피드백 budget 안에 들어가려면 setTimeout/promise
  // tick 이 들어가서는 안 된다.
  // date 2026-05-02
  it("[AC-193-01-2] beginCommitFlash flips to true synchronously", () => {
    const { result } = renderHook(() => useCommitFlash());
    act(() => {
      result.current.beginCommitFlash();
    });
    expect(result.current.isCommitFlashing).toBe(true);
  });

  // [AC-193-01-3] 400ms 후 자동 false. preview/error 로 explicit clear
  // 가 도달하지 못하는 경로 (validation-only no-op 등) 에서 spinner 가
  // stuck 되지 않도록 보장하는 안전망.
  // date 2026-05-02
  it("[AC-193-01-3] auto-clears to false after 400ms safety timeout", () => {
    const { result } = renderHook(() => useCommitFlash());
    act(() => {
      result.current.beginCommitFlash();
    });
    expect(result.current.isCommitFlashing).toBe(true);

    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(result.current.isCommitFlashing).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.isCommitFlashing).toBe(false);
  });

  // [AC-193-01-4] 연속 beginCommitFlash() 호출 시 이전 timer 가
  // cancel 되고 마지막 호출의 400ms 만 active. 사용자가 빠르게 두 번
  // commit 을 시도할 때 첫 번째 timer 가 두 번째 flash 를 조기 종료
  // 시키는 회귀 방지.
  // date 2026-05-02
  it("[AC-193-01-4] consecutive begin calls reset the safety timer", () => {
    const { result } = renderHook(() => useCommitFlash());
    act(() => {
      result.current.beginCommitFlash();
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // 두 번째 호출 — 처음 호출의 잔여 100ms timer 는 무효화돼야 한다.
    act(() => {
      result.current.beginCommitFlash();
    });
    // 처음 호출 기준 400ms 가 지났지만 두 번째 호출 기준 100ms 만
    // 지났으므로 여전히 true 여야 한다.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.isCommitFlashing).toBe(true);
    // 두 번째 호출 기준 400ms 가 지나면 비로소 false.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.isCommitFlashing).toBe(false);
  });

  // [AC-193-01-5] clearCommitFlash() 는 외부 terminal signal (preview
  // 가 열렸거나 commit error 가 surface 됐을 때) facade 가 호출하는
  // escape hatch. 동기적으로 false 로 전환되며 잔여 safety timer 도
  // drain 한다 (이후 timer 만료가 다시 false 로 set 해도 무해).
  // date 2026-05-02
  it("[AC-193-01-5] clearCommitFlash drops to false and drains pending timer", () => {
    const { result } = renderHook(() => useCommitFlash());
    act(() => {
      result.current.beginCommitFlash();
    });
    expect(result.current.isCommitFlashing).toBe(true);

    act(() => {
      result.current.clearCommitFlash();
    });
    expect(result.current.isCommitFlashing).toBe(false);

    // safety timer 가 drain 됐는지 확인 — 400ms 가 지나도 추가 set 이
    // 발생하면 안 된다 (값은 여전히 false 면 OK).
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.isCommitFlashing).toBe(false);
  });
});
