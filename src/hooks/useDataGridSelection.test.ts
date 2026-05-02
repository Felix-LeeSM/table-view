// AC-193-02 — `useDataGridSelection` sub-hook 단위 테스트. 4 분기
// (single click / meta-toggle add+remove / shift-range / shift-extend) 를
// 직접 단언. 기존 `useDataGridEdit.multi-select.test.ts` 가 통합 단언을
// 보존하지만 본 테스트는 hook 단의 selection state 머신을 격리한다.
// date 2026-05-02.
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataGridSelection } from "./useDataGridSelection";

describe("useDataGridSelection", () => {
  // [AC-193-02-1] 일반 click 은 anchor 와 함께 단일 행 선택. 후속
  // shift-click 의 range 시작점이 됨.
  // date 2026-05-02
  it("[AC-193-02-1] plain click selects single row and sets anchor", () => {
    const { result } = renderHook(() => useDataGridSelection());
    act(() => {
      result.current.handleSelectRow(3, false, false);
    });
    expect([...result.current.selectedRowIds]).toEqual([3]);
    expect(result.current.anchorRowIdx).toBe(3);
    expect(result.current.selectedRowIdx).toBe(3);
  });

  // [AC-193-02-2] meta-click 은 set 에 row 를 toggle add. anchor 는 첫
  // 추가 시점에만 set, 이후 anchor 가 보존돼야 후속 shift-range 가
  // 의도대로 동작한다.
  // date 2026-05-02
  it("[AC-193-02-2] meta-click toggles row in (add) and pins anchor", () => {
    const { result } = renderHook(() => useDataGridSelection());
    act(() => {
      result.current.handleSelectRow(2, true, false);
    });
    act(() => {
      result.current.handleSelectRow(5, true, false);
    });
    expect([...result.current.selectedRowIds].sort()).toEqual([2, 5]);
    expect(result.current.anchorRowIdx).toBe(2);
    // size === 2 이므로 single-row 액션은 비활성 (selectedRowIdx === null).
    expect(result.current.selectedRowIdx).toBeNull();
  });

  // [AC-193-02-3] meta-click 으로 이미 선택된 행을 toggle off. 멀티
  // 편집 후 한 행만 빼고 싶은 사용자 흐름.
  // date 2026-05-02
  it("[AC-193-02-3] meta-click toggles row out (remove)", () => {
    const { result } = renderHook(() => useDataGridSelection());
    act(() => {
      result.current.handleSelectRow(2, true, false);
    });
    act(() => {
      result.current.handleSelectRow(5, true, false);
    });
    act(() => {
      result.current.handleSelectRow(2, true, false);
    });
    expect([...result.current.selectedRowIds]).toEqual([5]);
    // size 가 1 로 줄어 single-row 액션 다시 활성화.
    expect(result.current.selectedRowIdx).toBe(5);
  });

  // [AC-193-02-4] anchor 가 있는 상태의 shift-click 은 inclusive
  // range 선택. 기존 set 을 대체 (extend 가 아니라 replace).
  // date 2026-05-02
  it("[AC-193-02-4] shift-click with anchor selects inclusive range", () => {
    const { result } = renderHook(() => useDataGridSelection());
    act(() => {
      result.current.handleSelectRow(2, false, false);
    });
    act(() => {
      result.current.handleSelectRow(5, false, true);
    });
    expect([...result.current.selectedRowIds].sort((a, b) => a - b)).toEqual([
      2, 3, 4, 5,
    ]);
    // anchor 는 보존 (다음 shift-click 이 동일 anchor 기준 새 range 를
    // 잡을 수 있어야 한다).
    expect(result.current.anchorRowIdx).toBe(2);
  });

  // [AC-193-02-5] anchor 없는 (초기) 상태의 shift-click 은 single
  // selection 으로 fallback + anchor 설정. 후속 shift-click 이 의미
  // 있게 동작하기 위함.
  // date 2026-05-02
  it("[AC-193-02-5] shift-click without anchor falls back to single selection", () => {
    const { result } = renderHook(() => useDataGridSelection());
    act(() => {
      result.current.handleSelectRow(7, false, true);
    });
    expect([...result.current.selectedRowIds]).toEqual([7]);
    expect(result.current.anchorRowIdx).toBe(7);
  });

  // [AC-193-02-6] clearSelection 은 페이지 전환 시 facade 가 호출하는
  // escape hatch. set 이 비어 있고 anchor 도 null 로 복귀.
  // date 2026-05-02
  it("[AC-193-02-6] clearSelection drops set and anchor", () => {
    const { result } = renderHook(() => useDataGridSelection());
    act(() => {
      result.current.handleSelectRow(2, true, false);
    });
    act(() => {
      result.current.handleSelectRow(5, true, false);
    });
    act(() => {
      result.current.clearSelection();
    });
    expect(result.current.selectedRowIds.size).toBe(0);
    expect(result.current.anchorRowIdx).toBeNull();
    expect(result.current.selectedRowIdx).toBeNull();
  });
});
