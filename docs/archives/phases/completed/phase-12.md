# Phase 12: Multi-Window Split (launcher/workspace 분리)

> **상태: 완료 (2026-04-27)** — Sprint 150–155 PASS, RISK-025 resolved, ADR 0011 → 0012 supersede.

## 배경

Sprint 149까지 launcher(연결 목록)와 workspace(테이블 뷰)는 단일 `WebviewWindow` 안에서 `appShellStore.screen` 토글로 전환됐다. TablePlus 사용자가 기대하는 "두 창" 워크플로우(연결 창은 좁고 고정, 작업 창은 넓고 가변)가 보존되지 않았고, single-window stub이 실제 OS 윈도우 lifecycle(show/hide/focus/close 이벤트)을 검증하지 못한다는 trade-off가 RISK-025로 남아 있었다.

Phase 12는 launcher 720×560 fixed window + workspace 1280×800 resizable window를 별도 `WebviewWindow`로 분리하고, 5개 store(connection / tab / mru / theme / favorites)에 cross-window IPC sync bridge를 부착해 두 창이 공유 상태를 관찰하도록 했다.

## Sprint 분해

| Sprint | 제목 | 결과 |
|---|---|---|
| 150 | Two-Window Foundation (`tauri.conf.json` + `launcher.rs` Tauri commands + `AppRouter` boot dispatch) | PASS |
| 151 | `attachZustandIpcBridge` 기본 모듈 (origin-id loop guard + per-key allowlist) | PASS |
| 152 | `connectionStore` IPC sync (allowlist: `connections`/`groups`/`activeStatuses`/`focusedConnId`) | PASS |
| 153 | 나머지 4 store sync(`tabStore` workspace-only / `mruStore` / `themeStore` / `favoritesStore`) + `appShellStore.screen` deprecation | PASS |
| 154 | Window lifecycle wiring (Activate / Back / Disconnect / Launcher-close / Workspace-close, `@lib/window-controls` seam) | PASS |
| 155 | Phase 12 closure: `it.todo` 5개 → 실제 `it()` 변환, ADR 0011 → 0012, RISK-025 resolved | PASS |

## 핵심 산출물

- `src-tauri/tauri.conf.json` — 두 windows 정의 (launcher visible/fixed, workspace hidden/resizable).
- `src-tauri/src/launcher.rs` — 7 Tauri commands (`launcher_show/hide/focus`, `workspace_show/hide/focus`, `app_exit`).
- `src/lib/zustand-ipc-bridge.ts` — 범용 store sync primitive.
- `src/lib/window-controls.ts` — 얇은 testable seam (`showWindow`/`hideWindow`/`focusWindow`/`exitApp`/`onCloseRequested`).
- `src/lib/window-lifecycle-boot.ts` — launcher close → app exit 핸들러.
- `src/AppRouter.tsx` — `getCurrentWindowLabel()` 기반 분기 (launcher → `LauncherPage` / workspace → `App`).
- ADR 0012 (`memory/decisions/0012-multi-window-launcher-workspace/memory.md`).

## 잔여 위험 / 후속 작업

- **jsdom 단위 테스트는 seam mock 의존** — 실제 `WebviewWindow.show/hide/setFocus` lifecycle은 e2e/수동 QA에서만 검증 가능. Phase 13 진입 시점에 사용자가 "더블클릭해도 workspace 창이 열리지 않는다" 보고 — Phase 13 Sprint 156에서 진단/수정.
- 5개 store IPC sync 표면(allowlist + origin echo)은 영구 유지. 새 store 추가 시 SYNCED_KEYS 명시 forcing mechanism 발동.

## 회고

- 4중 강제 메커니즘(ADR + RISK + `it.todo` + findings)이 5개 sprint 동안 deferred work를 잃지 않게 잡아줬다.
- TDD strict — 각 sprint마다 red-state.log 캡처 → wiring → green 순서를 지켰다.
- Sprint 153~155에서 `appShellStore.screen` 동결-축퇴-삭제 단계적 retirement 패턴이 잘 작동했다 (deprecate-and-narrow → vestigial seam → 완전 삭제).
