---
title: Mock 범위 — boundary stub, user-facing invariant 단언
type: convention
updated: 2026-05-28
task: test-writing, mock-scope, regression-guard
surface: '**/*.test.ts, **/*.test.tsx, vi.mock'
trigger:
  signal: 테스트 작성 / `vi.mock()` 사용
  layer: agent-prompt (tdd-generator / bug-fix) + 향후 ESLint custom rule 후보
---

# Mock 범위 — boundary stub, user-facing invariant 단언

테스트 시나리오 작성 시 user 의 행위 시퀀스를 *글로 적고* 그 path 의 마지막 outcome (user-facing invariant) 을 한 번이라도 단언. 단언이 "어떤 함수가 호출됐는지" (implementation detail) 만 lock 하면 mock 의 default success 가 silent failure 를 가려 회귀가 main 에 들어감.

## 시나리오 작성 절차

1. **User 의 행위 시퀀스 1~3 줄로 적기**:
   ```
   - 사용자가 connection 켜고 workspace 열림
   - workspace toolbar 의 Back 버튼 클릭
   - **window 가 destroy 되고 launcher 가 활성** ← lock 대상
   ```
2. **마지막 outcome 은 user 가 *눈으로 확인하는 사실*** — UI visible 요소, window 존재, modal mount, toast, store 의 user-facing slot.
3. **함수 호출 여부 / 액션 dispatch 여부는 implementation detail** — 단독으로 단언하지 마.

## Mock 범위

- **Pure/domain lib**: real import. parser, formatter, analyzer, serializer 를 mock
  으로 대체하지 않는다.
- **Stores**: 가능하면 real store + reset helper 를 쓴다. action 자체를 mock 해서
  사용자-visible state 전이를 가리지 않는다.
- **Runtime/boundary**: Tauri `invoke/listen/emit`, native window/dialog/file API,
  `fetch`, timer, network, filesystem 같은 외부 boundary 는 stub 가능하다.
- **Hooks/components**: target behavior 를 소유한 own hook/lib 는 real import 한다.
  단, page/container test 에서 무거운 child component 또는 runtime graph 를 줄이는
  narrow mock 은 허용한다. 이때 user-facing outcome 단언을 반드시 남긴다.
- 기존 own-code broad mock 은 touched scope 에서 바로 실패 처리하지 않는다. 새 테스트
  또는 수정 테스트는 broad mock 을 늘리지 말고, 가능한 범위에서 real import 로 낮춘다.

## jsdom 한계 대응

검증 불가능한 layer (Tauri runtime, NSMenu, native window lifecycle) 가 path 의 일부면:
- unit test 에 "이 시나리오는 unit 으로 cover 못 한다 — e2e 후보" 명시 코멘트.
- Backend Rust `MockRuntime` test 로 같은 invariant 를 *Rust 측에서* lock.
- 또는 E2E 시나리오 추가 (WebdriverIO + tauri-driver).

## Anti-pattern 예시 (회귀 4 실제 코드)

```ts
// ❌ Mock 광역 + implementation 만 lock
vi.mock("@lib/window-controls", () => ({
  destroyCurrentWindow: vi.fn(() => Promise.resolve()),
}));
it("Back clicks destroyCurrentWindow", () => {
  fireEvent.click(screen.getByRole("button", { name: /back/i }));
  expect(destroyCurrentWindow).toHaveBeenCalled();  // 호출만 lock, 동작 안 lock
});

// ✅ Mock 좁게 + user-facing invariant lock
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));
it("Back triggers the workspace_close IPC (path step)", () => {
  fireEvent.click(screen.getByRole("button", { name: /back/i }));
  expect(invoke).toHaveBeenCalledWith("workspace_close");  // 우리 own 코드 의도
});
// + backend MockRuntime test 가 invoke("workspace_close") → window destroy 단언
```

## Why

2026-05-16 wave 9.5 회귀 3 (모든 테마 slate 고정), 회귀 4 (Back 버튼이 창 안 닫음), Cmd+W/Cmd+N OS-level shortcut 부재 — 모두 unit test GREEN 통과한 상태로 사용자에게 도달. 공통 원인: 광역 mock 이 silent failure 가림.

사용자 명시 (2026-05-16): "테스트 시나리오 작성할 때, 유저의 플로우를 상상하면서 path 를 따라가도록 하는 원칙" — *그게 안 되었던 게 일련의 회귀의 root cause*.

## 관련

- [testing-scenarios](../memory.md) — 8 원칙. P2 (사용자 가시 행동), P6 (mock = boundary)
- [workflow/bug-fix](../../../../workflow/bug-fix/memory.md) — Red test 의 단언 형식
- [docs/archives/incidents/ui-patterns/2026-05-16-theme-selection-silent-fail](../../../../../docs/archives/incidents/ui-patterns/2026-05-16-theme-selection-silent-fail/memory.md) — 회귀 사례
