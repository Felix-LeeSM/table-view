---
title: A. 분해 boundary
type: memory
updated: 2026-05-02
---

# A. 분해 boundary

상위: [refactoring](../memory.md). 카테고리 A — god file 분해 시 어떤
경계로 가를지, commit 시퀀스 룰.

## A-1. 데이터/UI 분리 axis — 강한 룰

- 모든 god 컴포넌트 분해 시 **(a) data hook + (b) 순수 props 컴포넌트**
  두 layer 로 갈라낸다.
- store wiring 은 hook 안. 컴포넌트는 props 만.
- **이득**: 컴포넌트 테스트는 props mock (store mock 불필요), hook 테스트
  는 store mock. smell §8.1 (god test file mock 비대) 자연 해소.
- **예시 (Sprint 191)**: SchemaTree → `useSchemaCache(connectionId)` +
  `<SchemaTree>`.

## A-2. Paradigm 분기 axis — 두 hook 분리

- dual-paradigm hook 은 **두 hook 분리**. 옅은 façade 없음.
- **예시 (Sprint 193)**: `useDataGridEdit` → `useDataGridEditRdb`,
  `useDataGridEditDocument`. callsite 가 이미 paradigm 알고 있어 façade
  비용 > 가치.
- **공통 분리 단위**: `PendingChange` / `commit()` / `rollback()` 등 공통
  인터페이스 type 은 `src/types/dataGridEdit.ts` 로 추출. 두 hook 이 같은
  shape 노출.

## A-3. Sub-component 추출 임계 — 2-of-3

다음 중 **2 이상** 만족 시 별 파일:
- JSX subtree ≥ 80 라인
- 자체 local state 또는 props ≥ 4
- 다른 컴포넌트에서 재사용 가능성이 sprint 내 발생

미만은 같은 파일 안 named function OK.

## A-4. Hook 추출 임계 — 2-of-3

다음 중 **2 이상** 만족 시 컴포넌트 logic → hook:
- 같은 컴포넌트 안 `useEffect` + `useState` + `useMemo` + `useCallback`
  합 ≥ 5
- 같은 logic 이 2+ 컴포넌트에서 반복
- 컴포넌트 mock 없이 logic 단위 테스트 불가

A-1 의 data hook 추출은 본 임계와 무관하게 god file 에서는 **항상 적용**.

## A-5. God file 분해 commit 단위 — 5+ commit

**표준 commit 시퀀스**:
1. **pure 추출** — lib 으로 (D-3 적용; 행동 변경 0).
2. **data hook 추출** — store wiring 만 hook 으로 (행동 변경 0).
3. **sub-component 추출 #1** — 가장 독립적인 subtree 부터.
4. **sub-component 추출 #2..N** — 남은 axis 별.
5. **cleanup** — 남은 dead code, comment, import 정리.

각 commit 후 vitest / tsc / lint 모두 통과 — 중간 빨간 상태 0.

## 케이스별

- **변경 축 (axis of change) vs layer (data/UI)** — 보통 god file 은 둘 다
  적용. 충돌 시 **layer 우선** (A-1).
- **God test file 분할** — prod 분해 commit 마다 같이 갈라낸다 (assertion
  변경 0, 파일 이동만). 별도 commit 분리 안 함.
