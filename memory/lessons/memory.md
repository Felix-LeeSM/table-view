---
title: Lessons 인덱스
type: index
updated: 2026-05-13
---

# Lessons 인덱스

도메인별 7 방. 작업 시작 시 해당 도메인 방 `ls` 로 retrieval — flat list grep 의존 안 함.

## boot-windows — 부팅 / 멀티-윈도우 lifecycle

- [2026-04-29 · Tauri hidden workspace의 boot-time hydration은 빈 데이터를 읽는다 — window focus에서 re-hydrate 해야 한다](boot-windows/2026-04-29-cross-window-boot-hydration-race/memory.md)
- [2026-04-30 · Cold-boot 측정은 tracing::info! phase markers + Tauri 2 setup/on_page_load hooks가 가장 가벼운 instrumentation](boot-windows/2026-04-30-cold-boot-tracing-instrumentation/memory.md)
- [2026-04-30 · Tauri 2 다중 WKWebView spawn은 OS-level parallel — 한 윈도우 lazy화로는 wall-clock을 크게 못 줄인다](boot-windows/2026-04-30-wkwebview-spawn-os-parallel/memory.md)
- [2026-05-06 · webview-distributed state 의 broadcast/persist 비대칭 — store side-effect 추출은 origin ownership 분류 후 진입; e2e dead 시 invariant 변동 sprint deferred](boot-windows/2026-05-06-broadcast-persist-asymmetry-store-extraction-limit/memory.md)
- [2026-05-17 · sprint-365 emit_state_changed 함수는 만들었으나 sprint-368 persist_setting 이 호출 안 해 cross-window 테마 sync silent fail — caller wiring 이 두 sprint 사이 dark zone 으로 떨어짐](boot-windows/2026-05-17-state-changed-emit-missing-from-persist-setting/memory.md)
- [2026-05-17 · Tauri 2 capability allowlist 가 sprint-361 의 per-conn workspace 라벨 (`workspace-{conn_id}`) 을 미반영해 cross-window event 가 silent deny — 한 layer 더 깊은 silent fail](boot-windows/2026-05-17-capability-allowlist-misses-per-conn-workspace/memory.md)

## workspace-shell — toolbar / sidebar / tree 연결

- [2026-04-27 · workspace toolbar UX 갭 3건 (popover 크기 / connection SoT 분리 / paradigm-aware completion)](workspace-shell/2026-04-27-workspace-toolbar-ux-gaps/memory.md)
- [2026-04-29 · DbSwitcher는 active tab이 없을 때 focusedConnId 기반으로 activeDb를 표시해야 한다](workspace-shell/2026-04-29-dbswitcher-no-tab-fallback/memory.md)
- [2026-05-05 · DocumentDatabaseTree auto-load guard는 (connectionId, activeDb)로 keying — DbSwitcher swap이 cache를 비울 때 stale collection 노출 방지](workspace-shell/2026-05-05-document-tree-activedb-keyed-autoload/memory.md)

## ui-patterns — interaction primitives

- [2026-04-24 · React `autoFocus`는 form control에만 동작 — 비-form 요소는 ref + useEffect 필요](ui-patterns/2026-04-24-react-autofocus-form-control-only/memory.md)
- [2026-05-05 · Tauri 2 drag-drop은 두 게이트를 동시에 통과해야 — OS handler 비활성 + 이벤트 버블링 차단](ui-patterns/2026-05-05-tauri-drag-drop-os-intercept-and-bubble/memory.md)
- [2026-05-16 · ThemePicker preview 동작하지만 click 선택은 silent fail — mock 광역 stub 이 click → IPC → store → DOM 의 끝-끝 invariant 를 못 잡았다](ui-patterns/2026-05-16-theme-selection-silent-fail/memory.md)

## data-and-query — SQL / query / edit 정합성

- [2026-04-24 · user-facing SQL 필드에 내부 row_to_json 래퍼가 누출된 버그](data-and-query/2026-04-24-user-facing-sql-vs-internal-wrapper/memory.md)
- [2026-04-25 · FK 참조 점프 — 뼈대 완성돼 있으나 프론트/백엔드 문자열 포맷 불일치로 한 번도 작동 안 함](data-and-query/2026-04-25-fk-reference-string-contract-drift/memory.md)
- [2026-05-10 · 외부 도구가 Tauri storage 파일을 직접 만질 때 envelope (특히 password 암호화) 을 받는 쪽과 1:1 재현 + round-trip 테스트 + 앱 sanity smoke 필수](data-and-query/2026-05-10-fixture-password-storage-envelope/memory.md)

## e2e — e2e regression 패턴

- [2026-04-25 · UI 재설계는 e2e 셀렉터·동작 가정을 함께 갈아야 한다](e2e/2026-04-25-e2e-stale-after-ui-redesign/memory.md)
- [2026-05-06 · e2e 복구는 invariant 변경 refactor sprint 의 prerequisite — vite v6 OOM + cross-window 검증 surface 한 겹뿐](e2e/2026-05-06-vite-oom-host-prereq-cross-window-invariant/memory.md)

## agent-and-git — agent harness / commit 정책

- [2026-04-24 · 병렬 harness agent 진행 중 commit scope 격리](agent-and-git/2026-04-24-parallel-agent-commit-isolation/memory.md)
- [2026-04-24 · gpg 서명 필수 repo 에서 agent commit 은 gpg-agent 캐시가 살아 있는 동안만 성공 — 만료되면 pinentry 가 비대화형 세션을 막음](agent-and-git/2026-04-24-gpg-sign-pinentry-blocks-agent-commit/memory.md)

## workflow — sprint / phase / feedback workflow

- [2026-04-24 · 기능 유닛 완성 vs 사용자 흐름 엣지 검증 — Sprint 74-79 DoD 갭](workflow/2026-04-24-feature-unit-vs-user-flow-gap/memory.md)
- [2026-04-25 · 다중-sprint chain — 이전 sprint 산출물은 contract 의 git diff empty check 로 강제한다](workflow/2026-04-25-multi-sprint-protected-scope-diff/memory.md)
- [2026-04-25 · Phase 종료 시 정적 UI evaluation → sprint 분해 워크플로우 (Phase 5 = 3.17/5, 41 이슈 → sprint-88~119)](workflow/2026-04-25-phase-end-ui-evaluation-workflow/memory.md)
- [2026-04-27 · 피드백은 스펙 합의 → TDD 순서로 처리한다](workflow/2026-04-27-feedback-spec-first-tdd/memory.md)
- [2026-04-27 · Phase 종료 시 skip된 테스트는 0건 / 메모리 등록 / skip 메시지 컨텍스트 셋 중 하나여야 한다](workflow/2026-04-27-phase-end-skip-accountability-gate/memory.md)
- [2026-05-06 · architectural shift (Rust=server) 의 vitest mockability 트레이드오프 — 검증 surface 비교를 sprint planning 의 invariant 섹션에 명시](workflow/2026-05-06-architectural-shift-vitest-mockability-tradeoff/memory.md)

## parity-milestone — phase 종료 회고 (one-off; Phase 27 closure 전용)

- [2026-05-13 · TablePlus 패리티 7단계 (Phase 21–27) 종료 회고 — Sprint 226→237 cycle 의 결정 / 패턴 / 닫힌 surface / 미달 항목](parity-milestone/2026-05-13-tableplus-parity-phase-27-closure/memory.md)

## 형식

- 디렉토리: `<domain>/YYYY-MM-DD-<slug>/memory.md`
- 본문 3줄 inline: 상황 / 원인 / 재발 방지.
- 도메인 cross-cut lesson 은 한 도메인에만 두고 인덱스에서 cross-link.
- 새 도메인 임계: 한 lesson 만 든 도메인 신설 금지 (조기 분기). 2-3건 쌓이면 분기 검토.
