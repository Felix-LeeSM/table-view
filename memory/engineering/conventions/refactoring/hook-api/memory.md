---
title: C. Hook API shape
type: memory
updated: 2026-05-02
---

# C. Hook API shape

상위: [refactoring](../memory.md). 카테고리 C — custom hook 의 시그니처 /
return shape / deps / sub-grouping 룰.

## C-1. Return shape — 객체 통일

- hook return 은 **객체** (`{ decide, isReady, error }`). named field.
- **예외**: 튜플은 `useState` / `useReducer` 같은 React primitive 의 직접
  wrapper 에만.

## C-2. Deps stability — useCallback 강제

- hook 이 외부로 노출하는 모든 함수는 `useCallback` 으로 감싸 안정 ref
  보장. deps 배열 정확.
- **금지**: `// eslint-disable-next-line react-hooks/exhaustive-deps` 신규
  도입 0.
- **기존 violations 정리** (smell §6 4 사이트):
  - DataGridTable:552 → Sprint 193
  - SchemaTree:519 → Sprint 191
  - DataGrid:116 → Sprint 193
  - DocumentDatabaseTree:230 → 별도 결정 (이번 plan 밖일 수 있음 — sprint
    closure 시점에 재평가)

## C-3. 최신 참조 패턴 — 단순 ref

- **권장**: `const xRef = useRef(); xRef.current = x;` +
  `useCallback(() => xRef.current(), [])` 형태로 deps 0 의 stable 콜백.
- **비권장**: 자체 `useEvent` 구현 / 라이브러리 import. React 19
  `useEffectEvent` stable 시점에 재평가.

## C-4. Hook 시그니처 — input 형태

- 인자 ≤2 또는 (필수 1 + optional 1) 까지는 **positional**.
- 그 이상 / optional 다수면 **객체** (`{ id, options }`).
- 예: `useSafeModeGate(connectionId)` — positional 1 OK.
  `useDataGridEdit({ paradigm, tableId, columns, onCommit, options })` —
  객체.

## C-5. Hook sub-grouping — 15개 임계 flat

- 현재 7개 + 본 plan 분해로 +5 예상 → ~12개. **15개 미만 flat 유지**.
- 15+ 시점 도메인 sub-folder (`hooks/data-grid/`, `hooks/schema/` 등)
  재평가.

## 케이스별 (일반 룰 강제 안 함)

- **Cleanup / cancellation**: hook 별 시나리오 다름 (queryId guard /
  mounted ref / AbortController). 각 분해 sprint contract 가 케이스별
  결정.
- **에러 surface**: return `error` 필드 vs `onError` prop vs throw —
  호출자 패턴별. over-engineering 회피.
- **Effect 분리**: 의존 분기 시 분리 권장이지만 hard rule 아님 — 한 effect
  안 분기가 더 읽기 좋으면 OK.
