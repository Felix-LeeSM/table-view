---
title: 리팩토링 코드 작성 기준
type: memory
updated: 2026-05-02
---

# 리팩토링 코드 작성 기준

Sprint 189–198 의 refactor / feature 커밋이 일관되게 따를 **코드 작성
기준** (product axis). 4 카테고리 (B / D / C / A) 로 sub-room 분할.

작업 sequencing 은 [`docs/refactoring-plan.md`](../../../docs/refactoring-plan.md)
(시한부, Sprint 198 종료 후 retire). 본 룰셋은 **영속** — 198 종료 후에도
유지.

이미 정해진 룰 (`react-conventions.md`, `testing.md`, `test-scenarios.md`,
`memory/conventions/memory.md`) 은 그대로 상속. 본 방은 **리팩토링 sprint
에서 추가로 강제하는 항목** 만 다룬다.

## 카테고리별 방

- [store-coupling](./store-coupling/memory.md) — **B**. `useXStore.setState`
  직접 호출 금지, action 분할 단위, stale guard 위치, cross-store 결합
  제한, 명명 규칙, 강제 메커니즘 단계.
- [lib-hook-boundary](./lib-hook-boundary/memory.md) — **D**. `lib/hooks/
  components` 3 layer 분리, import 방향, pure 추출 강도, lib sub-grouping.
- [hook-api](./hook-api/memory.md) — **C**. return shape (객체), deps
  stability (`useCallback` 강제), 최신 참조 패턴, hook 시그니처, sub-grouping
  임계.
- [decomposition](./decomposition/memory.md) — **A**. data/UI 분리 axis,
  paradigm 분기 axis, sub-component / hook 추출 임계 (2-of-3), god file
  commit 시퀀스 (5+ commit).

## 강제 메커니즘 — 단계적

| 룰 | Phase 1 (지금) | Phase 2 (도입 예정) | Phase 3 (보류) |
|----|----------------|---------------------|----------------|
| B-1 (setState 금지) | sprint findings audit | ESLint `no-direct-zustand-setstate` | TS 레벨 차단 |
| C-2 (exhaustive-deps ignore 0) | sprint findings audit | 기존 ESLint 룰 (이미 활성) | — |
| D-1/D-2 (lib React 의존 0) | sprint findings audit | ESLint `no-restricted-imports` (lib 에서 react import 차단) | — |
| 그 외 | convention + review | (필요 시 검토) | — |

Phase 2 ESLint 룰 도입 시점: **Sprint 198 종료 직후** (모든 refactor sprint
의 violations 0 달성 후 일괄 도입).

## 관련 방

- [conventions](../memory.md) — Rust/TS 기본 컨벤션 + 금지 사항.
- [architecture](../../architecture/memory.md) — 모듈 구조 (lib / hooks /
  components / stores).
- [decisions](../../decisions/memory.md) — ADR 이력.
