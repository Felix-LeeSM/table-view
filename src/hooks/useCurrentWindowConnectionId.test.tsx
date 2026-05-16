// 작성 2026-05-16 (Phase 4 sprint-366)
//
// 사유: state-management-strategy Q15 lock — workspace window 의 connection
// identity 는 더 이상 `connectionStore.focusedConnId` 가 아니라 Tauri
// window label (`workspace-{connection_id}`) 에서 derive. 본 훅은 그 derive
// 의 단일 site 로서, 모든 workspace tree 의 caller (Sidebar, useCurrentWorkspaceKey,
// 등) 가 직접 `parseWorkspaceLabel` 을 호출하지 않고 이 훅을 통해 한 번
// 캐시된 값을 읽도록 만든다.
//
// AC mapping:
//   - AC-366-01: launcher window → null
//   - AC-366-02: workspace window → connection_id
//   - AC-366-03: invalid label → null
//
// 시나리오 8원칙 (testing-scenarios):
//   - Happy path: workspace-conn-1 → "conn-1"
//   - 빈/누락 입력: label === null (Tauri 비활성) → null
//   - 상태 전이: 두 다른 label 로 hook 재마운트 → 새 결과

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@lib/window-label", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return {
    ...actual,
    getCurrentWindowLabel: vi.fn(),
  };
});

import { getCurrentWindowLabel } from "@lib/window-label";
import { useCurrentWindowConnectionId } from "./useCurrentWindowConnectionId";

const mockedGetLabel = vi.mocked(getCurrentWindowLabel);

describe("useCurrentWindowConnectionId", () => {
  beforeEach(() => {
    mockedGetLabel.mockReset();
  });

  afterEach(() => {
    mockedGetLabel.mockReset();
  });

  it("AC-366-01: returns null on the launcher window", () => {
    // 사유: launcher window 의 label 은 bare `"launcher"`. 그 window 에선
    // connection identity 라는 개념 자체가 없으므로 (사용자가 connection
    // 을 고르기 *전* 단계) hook 은 null 을 돌려준다. 이 값이 workspace tree
    // 캐스케이드 (Sidebar 등) 에 전달되면 그쪽은 "어떤 connection 도 focus
    // 되지 않음" 으로 해석한다.
    mockedGetLabel.mockReturnValue("launcher");
    const { result } = renderHook(() => useCurrentWindowConnectionId());
    expect(result.current).toBeNull();
  });

  it("AC-366-02: returns the connection_id for a workspace label", () => {
    // 사유: workspace window 의 label 패턴은 sprint-361 의 round-trip
    // `workspace-{connection_id}` 이다. 본 훅은 label 에서 conn id 를
    // 추출해 반환해야 한다. 멀티-윈도우 시나리오에서 각 workspace 가
    // 자기 자신의 connection 만 표시하도록 만드는 핵심 derive.
    mockedGetLabel.mockReturnValue("workspace-conn-1");
    const { result } = renderHook(() => useCurrentWindowConnectionId());
    expect(result.current).toBe("conn-1");
  });

  it("AC-366-03: returns null for an unknown label string", () => {
    // 사유: label 이 미인식 (예: 외부 도구가 attach, 또는 잔존 path)
    // → 안전한 fallback 으로 null. 호출 사이트는 null 을 "focus 없음" 으로
    // 처리하므로 unsafe state 가 새지 않는다.
    mockedGetLabel.mockReturnValue("ghost-label");
    const { result } = renderHook(() => useCurrentWindowConnectionId());
    expect(result.current).toBeNull();
  });

  it("returns null when getCurrentWindowLabel returns null (Tauri 비활성)", () => {
    // 사유: vitest jsdom 처럼 Tauri runtime 이 없는 환경에서
    // getCurrentWindowLabel() 은 null 을 돌려준다. Hook 도 그 신호를
    // 통과시켜 null 로 떨어져야 함 — 그래야 fake Tauri 없이도 workspace
    // tree 컴포넌트가 mount 가능.
    mockedGetLabel.mockReturnValue(null);
    const { result } = renderHook(() => useCurrentWindowConnectionId());
    expect(result.current).toBeNull();
  });

  it("returns null for the legacy bare 'workspace' label (pre-sprint-361)", () => {
    // 사유: bare `"workspace"` label 은 sprint-361 이후 emit 되지 않지만,
    // 외부 path 에서 surface 됐을 때 safe fallback 으로 null. (Router
    // 도 동일 fallback — `window-label.test.ts` 와 `window-resolve.test.tsx`
    // 가 lock.)
    mockedGetLabel.mockReturnValue("workspace");
    const { result } = renderHook(() => useCurrentWindowConnectionId());
    expect(result.current).toBeNull();
  });

  it("returns null for an empty conn_id (`workspace-`)", () => {
    // 사유: degenerate "workspace-" label 은 parseWorkspaceLabel 이 null
    // 을 돌려주는 케이스다 (window-label.ts:60). Hook 도 그 결정을 그대로
    // 통과시켜야 한다.
    mockedGetLabel.mockReturnValue("workspace-");
    const { result } = renderHook(() => useCurrentWindowConnectionId());
    expect(result.current).toBeNull();
  });

  it("preserves UUID-style conn_id with internal dashes", () => {
    // 사유: connection_id 가 UUID 인 케이스 — `workspace-` 접두만 제거하고
    // 본체는 보존. parseWorkspaceLabel 의 round-trip 보증을 hook 이 깨지
    // 않는지 확인.
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    mockedGetLabel.mockReturnValue(`workspace-${uuid}`);
    const { result } = renderHook(() => useCurrentWindowConnectionId());
    expect(result.current).toBe(uuid);
  });
});
