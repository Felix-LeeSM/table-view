---
title: Lessons 인덱스
type: index
updated: 2026-04-30
---

# Lessons 인덱스

## 등록된 교훈

- [2026-04-24 · user-facing SQL 필드에 내부 row_to_json 래퍼가 누출된 버그](2026-04-24-user-facing-sql-vs-internal-wrapper/memory.md)
- [2026-04-24 · React `autoFocus`는 form control에만 동작 — 비-form 요소는 ref + useEffect 필요](2026-04-24-react-autofocus-form-control-only/memory.md)
- [2026-04-24 · 병렬 harness agent 진행 중 commit scope 격리](2026-04-24-parallel-agent-commit-isolation/memory.md)
- [2026-04-24 · 기능 유닛 완성 vs 사용자 흐름 엣지 검증 — Sprint 74-79 DoD 갭](2026-04-24-feature-unit-vs-user-flow-gap/memory.md)
- [2026-04-24 · gpg 서명 필수 repo 에서 agent commit 은 gpg-agent 캐시가 살아 있는 동안만 성공 — 만료되면 pinentry 가 비대화형 세션을 막음](2026-04-24-gpg-sign-pinentry-blocks-agent-commit/memory.md)
- [2026-04-25 · FK 참조 점프 — 뼈대 완성돼 있으나 프론트/백엔드 문자열 포맷 불일치로 한 번도 작동 안 함](2026-04-25-fk-reference-string-contract-drift/memory.md)
- [2026-04-25 · 다중-sprint chain — 이전 sprint 산출물은 contract 의 git diff empty check 로 강제한다](2026-04-25-multi-sprint-protected-scope-diff/memory.md)
- [2026-04-25 · UI 재설계는 e2e 셀렉터·동작 가정을 함께 갈아야 한다](2026-04-25-e2e-stale-after-ui-redesign/memory.md)
- [2026-04-27 · workspace toolbar UX 갭 3건 (popover 크기 / connection SoT 분리 / paradigm-aware completion)](2026-04-27-workspace-toolbar-ux-gaps/memory.md)
- [2026-04-27 · 피드백은 스펙 합의 → TDD 순서로 처리한다](2026-04-27-feedback-spec-first-tdd/memory.md)
- [2026-04-27 · Phase 종료 시 skip된 테스트는 0건 / 메모리 등록 / skip 메시지 컨텍스트 셋 중 하나여야 한다](2026-04-27-phase-end-skip-accountability-gate/memory.md)
- [2026-04-29 · Tauri hidden workspace의 boot-time hydration은 빈 데이터를 읽는다 — window focus에서 re-hydrate 해야 한다](2026-04-29-cross-window-boot-hydration-race/memory.md)
- [2026-04-29 · DbSwitcher는 active tab이 없을 때 focusedConnId 기반으로 activeDb를 표시해야 한다](2026-04-29-dbswitcher-no-tab-fallback/memory.md)
- [2026-04-25 · Phase 종료 시 정적 UI evaluation → sprint 분해 워크플로우 (Phase 5 = 3.17/5, 41 이슈 → sprint-88~119)](2026-04-25-phase-end-ui-evaluation-workflow/memory.md)
- [2026-04-30 · Cold-boot 측정은 tracing::info! phase markers + Tauri 2 setup/on_page_load hooks가 가장 가벼운 instrumentation](2026-04-30-cold-boot-tracing-instrumentation/memory.md)
- [2026-04-30 · Tauri 2 다중 WKWebView spawn은 OS-level parallel — 한 윈도우 lazy화로는 wall-clock을 크게 못 줄인다](2026-04-30-wkwebview-spawn-os-parallel/memory.md)

## 형식

- 디렉토리: `YYYY-MM-DD-<slug>/memory.md`
- 본문 3줄 inline: 상황 / 원인 / 재발 방지.
