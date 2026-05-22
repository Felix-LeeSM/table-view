# Sprint 315 Contract (Slice C.1)

> Phase 28 Slice C (Q8) — Multi-column sort + column header context menu
> (RDB+Mongo). **C.1 = Mongo DataGrid sort wire-up**. C.2 = context menu
> 는 Sprint 316.

## Scope

- `DocumentDataGrid` 의 inline header div 를 paradigm-shared `HeaderRow`
  컴포넌트로 교체. RDB 와 동일한 sort indicator (▲/▼ + rank).
- `DocumentDataGrid` 에 `sorts: SortInfo[]` local state 추가. RDB
  `handleSort` 의 click / shift+click 패턴을 1:1 복제.
- `useDocumentGridData` 에 `sorts` 파라미터 추가. `runFind` body 의
  `sort` 필드로 변환 (`SortInfo[]` → `{ field: 1 | -1 }` Mongo
  shape).
- `executed_query` 가 `db.coll.find({}).sort({...}).skip(...).limit(...)`
  형태로 sort 반영 (history 의 가독성).
- Toolbar 의 `sorts={[]}` stub 제거 → 실제 sorts 전달.

## Out of Scope (Sprint 316 으로 이월)

- Column header right-click context menu (Sort ASC / DESC / Add to
  sort / Clear all sorts). RDB+Mongo 양쪽 UI 변경.
- Workspace store 통합 (cross-session persist) — local state 로
  시작. 사용자가 collection tab 닫고 다시 열면 sort 초기화.
- Column drag-reorder — RDB 는 미구현. Mongo 도 미구현. Slice C 의
  핵심 outcome 인 sort 만 처리.

## Invariants

- 기존 RDB DataGrid sort 동작 회귀 0. `HeaderRow` 컴포넌트 미수정.
- 기존 Mongo grid 의 column header layout (이름 + data_type 2-line)
  유지. `HeaderRow` 는 동일 layout 채택.
- `find_documents` IPC 시그니처 미수정 (`FindBody.sort` 이미 존재).
- `useDataGridEdit` / pendingEdits / 셀 편집 동작 미영향.
- 기존 DocumentDataGrid 테스트들 (`*.test.tsx`) sort 미사용 분기 통과.

## Done Criteria

1. DocumentDataGrid 의 column header 가 click 시 sort ASC, 재 click 시
   DESC, 세 번째 click 시 sort 해제.
2. Shift+click 으로 secondary sort 추가. 같은 column shift+click 은
   ASC↔DESC cycle, DESC 에서 한 번 더 누르면 제거.
3. sort indicator (rank + ▲/▼) 가 column header 에 표시.
4. `useDocumentGridData` 가 `sorts` 를 받아 `runFind` body 의 `sort`
   필드로 wire. 빈 배열 → `undefined` (기존 동작 유지).
5. `executed_query` history 텍스트가 sort 반영 (`db.coll.find({})
   .sort({ a: 1 })`).
6. 신규 unit/component test ≥ 4:
   - `useDocumentGridData` 가 `sorts=[]` 일 때 sort 없이 호출
   - `useDocumentGridData` 가 sorts 전달 시 mongo shape 으로 변환
   - DocumentDataGrid header click → onApply 가 sort wire
   - shift+click → secondary sort
7. 기존 DocumentDataGrid 테스트 회귀 0.
8. `pnpm vitest run` / `tsc --noEmit` / `lint` / `build` exit 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run src/components/document/DocumentDataGrid src/components/document/DocumentDataGrid.*`
  2. `pnpm vitest run` 전체
  3. `pnpm tsc --noEmit && pnpm lint && pnpm build`
- Required evidence:
  - 변경 파일 + 목적
  - 신규 테스트 + assertion
  - baseline 3625/10 → 신규 카운트
  - 자율 D-29..D-31

## 자율 결정 가이드라인

- **D-Q9** SortInfo 의 store 위치 — workspaceStore.tab.sorts vs local
  state? **권장: local state**. 근거: collection tab 의 sort 는
  ephemeral 한 view 결정. cross-session persist 가 필요한 경우 별도
  sprint 에서 store 통합. 우선 RDB parity 의 mechanic (click/shift)
  만 lock.
- **D-Q10** HeaderRow 재사용 vs Mongo 전용 헤더 컴포넌트? **권장:
  HeaderRow 재사용**. 근거: 이미 `TableData` + `SortInfo[]` 만 받아
  paradigm-agnostic. 중복 코드 회피 + RDB↔Mongo UX parity 확정.
- **D-Q11** sort indicator 의 _id 시각화 — `_id` column 도 동일하게
  sort 가능? **권장: 가능**. Mongo 의 `_id` 는 default index 가 있어
  cheap. 사용자 의도 차단할 이유 없음.

## Files (예상)

- `src/components/document/DocumentDataGrid/useDocumentGridData.ts` —
  `sorts` param + body wire + executed_query 반영
- `src/components/document/DocumentDataGrid.tsx` — sort state +
  handleSort + HeaderRow 사용
- `src/components/document/DocumentDataGrid/useDocumentGridData.test.ts`
  (없으면 신설) — sort 변환 unit
- `src/components/document/DocumentDataGrid.sort.test.tsx` (신규) —
  header click → onApply
- `docs/phases/phase-28-decision-log.md` — D-29..D-31
- `docs/sprints/sprint-315/handoff.md`

## Residual Risk

- column reorder 미지원 — `HeaderRow` 의 `order` 는 항상 identity
  `[0..n-1]`. RDB 도 동일.
- workspace store 통합 부재 — collection tab 닫고 다시 열면 sort
  초기화. Sprint 316 또는 별도 sub-sprint 에서 평가.
- Mongo 의 `_id` sort 는 cheap (default index), 다른 unindexed field
  sort 는 큰 collection 에서 expensive — 별도 explain (Phase 29 U2)
  에서 visibility 제공.
