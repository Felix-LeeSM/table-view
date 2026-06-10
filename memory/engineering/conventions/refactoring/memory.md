---
title: 리팩토링 코드 작성 기준
type: memory
updated: 2026-06-11
---

# 리팩토링 코드 작성 기준

Sprint 189–198 의 refactor / feature 커밋이 일관되게 따를 **코드 작성
기준** (product axis). 4 카테고리 (B / D / C / A) 로 sub-room 분할.

작업 sequencing 은 2026-05-02 Sprint 198 종료로 완료. 각 sprint 의
contract / findings / handoff 는 `docs/sprints/sprint-189` ~ `sprint-198`
가 source of truth. 본 룰셋은 **영속** — 198 이후 신규 refactor 에도 동일
적용.

이미 정해진 룰 (`react-conventions.md`, `testing.md`, `test-scenarios.md`,
`memory/engineering/conventions/memory.md`) 은 그대로 상속. 본 방은 **리팩토링 sprint
에서 추가로 강제하는 항목** 만 다룬다.

## 카테고리별 방

- [store-coupling](./store-coupling/memory.md) — **B**. `useXStore.setState`
  direct write 축소, action 분할 단위, stale guard 위치, runtime use-case
  중앙화, 명명 규칙, 강제 메커니즘 단계.
- [lib-hook-boundary](./lib-hook-boundary/memory.md) — **D**. pure lib /
  runtime lib / hooks / components 분리, import 방향, pure 추출 강도, lib
  sub-grouping.
- [hook-api](./hook-api/memory.md) — **C**. return shape (객체), deps
  stability (`useCallback` 강제), 최신 참조 패턴, hook 시그니처, sub-grouping
  임계.
- [decomposition](./decomposition/memory.md) — **A**. data/UI 분리 axis,
  paradigm 분기 axis, sub-component / hook 추출 임계 (2-of-3), god file
  commit 시퀀스 (5+ commit).

## 강제 메커니즘 — 단계적

| 룰 | Phase 1 (지금) | Phase 2 (도입 예정) | Phase 3 (보류) |
|----|----------------|---------------------|----------------|
| B-1 (setState direct write 축소) | legacy debt 명시 + sprint findings audit | ESLint `no-direct-zustand-setstate` | TS 레벨 차단 |
| C-2 (exhaustive-deps ignore 0) | sprint findings audit | 기존 ESLint 룰 (이미 활성) | — |
| D-1/D-2 (lib React 의존 0) | sprint findings audit | ESLint `no-restricted-imports` (lib 에서 react import 차단) | — |
| 그 외 | convention + review | (필요 시 검토) | — |

Phase 2 ESLint 룰 도입 시점: 현재 legacy debt 를 store action 또는
`src/lib/runtime/**` use-case 로 낮춘 뒤.

## Frontend domain strangler

- Domain-first frontend migration order: connection -> completion -> query ->
  catalog/schema -> result-grid/datagrid -> workspace.
- Public feature API 기본값은 `src/features/<domain>/index.ts` 다.
  Cross-feature production import 는 public feature API 또는 명시된 shared
  contract layer 만 통한다.
- Final boundary enforcement 는 prerequisite domains 이동 뒤에만 적용한다. 적용 뒤
  새 code 는 compatibility barrel/legacy feature root 를 import 하지 않는다.
- Compatibility row 는 `migration-only`, `permanent-wire-compatibility`,
  `removable-debt` 로 분류한다. `migration-only` 는 same-milestone removal 또는
  owner issue evidence 가 필요하다.
- Refactor 02 는 behavior-preserving source movement 다. Product docs/support
  claim 은 behavior 가 바뀐 PR 에서만 바꾼다.

## 관련 방

- [conventions](../memory.md) — Rust/TS 기본 컨벤션 + 금지 사항.
- [architecture](../../architecture/memory.md) — 모듈 구조 (lib / hooks /
  components / stores).
- [docs/archives/decisions](../../../../docs/archives/decisions/memory.md) — historical ADR archive.
