# Sprint 182 — Generator Findings

Phase 22 / TablePlus parity #2: RDB 인라인 편집 게이트의 1차 완성 — Pending
Changes 트레이 + PK-부재 defense-in-depth 가드. Single-attempt
implementation. All Required Checks (Verification Plan §1–§5) pass; the
operator browser smoke (§6) is documented as a runbook for replay because
this generator session has no windowed environment.

## 트레이 위치 결정

`PendingChangesTray` 는 `EditableQueryResultGrid` 의 toolbar (Commit /
Discard 헤더) **바로 아래**, 그리드 본문 **바로 위**에 마운트된다.
`<div className="flex-1 overflow-auto">` 그리드 영역과 분리되어 있어 행
스크롤이 트레이를 가리지 않는다. 트레이 자체는 `border-t border-border
bg-muted/30` 으로 시각 구분, 헤더 1줄 + `max-h-48 overflow-y-auto` 본문
영역. 5+ 항목 누적 시 트레이 본문만 스크롤한다.

contract §"Design Bar" 의 "그리드 본문 바로 아래" 표현은 "그리드 본문
영역(=스크롤되는 셀 컨테이너) 바로 아래"가 아니라 "전체 데이터 그리드
구조의 가장 위 (toolbar 직후)"로 해석했다 — 사용자가 pending 변경을
확인하면서 그리드 셀을 동시에 볼 수 있어야 하기 때문이다. AC-182-01a..d
와 AC-182-06a 의 vitest 단언은 둘 다 위치에 무관하므로 이 결정은
회귀 위험 없음.

## Stateless props 시그니처

```tsx
interface PendingChangesTrayProps {
  result: QueryResult;
  pendingEdits: Map<string, string>;
  pendingDeletedRowKeys: Set<string>;
  plan: RawEditPlan;
  onRevertEdit: (key: string) => void;
  onRevertDelete: (rowKey: string) => void;
}
```

`EditableQueryResultGrid` 가 단일 진실원이며 트레이는 props 만 받고 X
버튼 클릭 시 콜백만 신호한다. 이유:

- 향후 Sprint 183 의 Mongo paradigm 재배치에서 `DocumentDataGrid` 가
  같은 시그니처를 그대로 받아쓸 수 있다 (스토어 도입 없이 props 전달만
  바꾸면 됨).
- 부모는 이미 `pendingEdits` / `pendingDeletedRowKeys` setter 를
  보유하므로 추가 store 가 도입되면 dual-source 발산 위험.
- `handleRevertEdit(key)` / `handleRevertDelete(rowKey)` 는 setter 안에서
  `prev.has(key)` 체크 + 새 Map/Set 반환의 React 정합 패턴.

각 항목의 SQL 은 `buildRawEditSql` 를 단일 항목 (`new Map([[key, value]])`
/ `new Set([rowKey])`) 으로 호출해 만든다. 이 때문에 SQL Preview Dialog
와 트레이의 SQL 컬럼이 동일 quoting / NULL 매핑을 공유한다 — invariant.

## PK 가드의 3 layer

방어 깊이는 3겹이다:

1. **`analyzeResultEditability`** (queryAnalyzer.ts) — 단일-테이블
   SELECT 가 PK 칼럼을 result projection 에 포함하지 않으면 `editable:
   false` 반환. `QueryResultGrid` 가 read-only `<ResultTable>` 로
   분기. 정상 경로에서는 `EditableQueryResultGrid` 가 마운트되지 않는다.
2. **`EditableQueryResultGrid` props 가드** (본 sprint 신규) — 그래도
   PK-less plan 이 props 로 들어왔을 때 `noPk = plan.pkColumns.length ===
   0`. (a) `startEdit` early-return → 더블클릭이 editor 를 열지 않음.
   (b) context-menu Edit Cell + Delete Row → `disabled: noPk` (ContextMenu
   는 `aria-disabled` 로 렌더). (c) 그리드 상단에 `Read-only — primary
   key required to edit` banner.
3. **`buildPkWhere` 본체** (`rawQuerySqlBuilder.ts:38-50`) — 마지막
   안전망. PK 가 비어 있으면 `pkColumns.map(...).join(" AND ")` 가 빈
   문자열 → `WHERE ` (trailing space) 가 되며, DB 엔진이 syntax error 로
   reject. 본 sprint 는 이 동작을 변경하지 않는다 (invariant) — 1·2 가
   먼저 차단해 도달 불가하기 때문.

테스트는 layer 2 의 세 단언만 cover (AC-182-03a..c). Layer 1 은 sprint
86 의 기존 테스트가 cover, layer 3 은 의도적으로 unit test 미포함 (DB
엔진 동작이라 mock 으로 reproducing 가치 낮음).

## Empty string ↔ NULL 모호성 처리

`rawQuerySqlBuilder.ts:82` — `const valueLiteral = newValue === "" ?
"NULL" : quoteString(newValue);`. 이 결정은 sprint 87 부터 존재하지만
사용자 가시면(visibility) 이 없었다. 본 sprint 는 트레이의 "새값" 컬럼이
빈 문자열일 때:

```tsx
<span className="italic text-muted-foreground"
      title="Empty input is treated as SQL NULL">
  NULL
</span>
```

italic 으로 일반 입력값과 시각 구분, hover 시 tooltip 으로 정확한
의미 노출. 빌더 본체 코드는 변경하지 않았다 (회귀 위험). 회귀
가드 1건을 `rawQuerySqlBuilder.test.ts` 에 추가 (AC-182-04b) —
빌더의 `"" → NULL` 매핑이 이후 변경되지 않았음을 명시적으로 핀다.

## AC → 테스트 매핑

| AC          | Tests                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| AC-182-01   | `PendingChangesTray.test.tsx` — empty / 1 edit / 1 delete / mixed                                      |
| AC-182-02   | `PendingChangesTray.test.tsx` — revert edit X / revert delete X                                        |
| AC-182-03   | `EditableQueryResultGrid.test.tsx` — `[AC-182-03a/b/c]` (3 cases)                                      |
| AC-182-04   | `PendingChangesTray.test.tsx` — `[AC-182-04a]` italic NULL + tooltip; `rawQuerySqlBuilder.test.ts` — `[AC-182-04b]` 회귀 |
| AC-182-05   | `PendingChangesTray.test.tsx` — `[AC-182-05a]` 헤더 카운터                                              |
| AC-182-06   | `EditableQueryResultGrid.test.tsx` — `[AC-182-06a]` 트레이 마운트 후 Cmd+S → SQL Preview 경로 동등 |

## Evidence index

- Vitest full suite: **2540 / 2540 pass** (Sprint 181 의 2527 → +13 from
  본 sprint 추가 테스트).
- Sprint-182 touched files: tray (8) + grid (4 추가 = 13 total) + builder
  (1 추가 = 10 total) — 모두 green.
- `pnpm tsc --noEmit`: zero errors.
- `pnpm lint`: zero errors.
- Static greps (Verification Plan §5):
  - `git diff src/lib/rawQuerySqlBuilder.ts` — empty (invariant).
  - `git diff src/components/datagrid/useDataGridEdit.ts` — empty (invariant).
  - `git diff src/types/connection.ts` — empty (invariant).
  - `grep "Read-only — primary key required to edit"` — 2 hits
    (production + 테스트).
  - `grep "PendingChangesTray" EditableQueryResultGrid.tsx` — 2 hits
    (import + 마운트).
  - `grep -E 'it\.(skip|todo)|xit\('` — 0 hits.

## Operator runbook (smoke replay)

Verification Plan §6 (`pnpm tauri dev` browser smoke) was not executed in
this generator session. Operator replay steps:

1. `pnpm tauri dev`.
2. PG 연결 → SELECT (PK 있는 테이블, 예: `SELECT * FROM users`) →
   editable 그리드 → 셀 더블클릭 → 값 변경 → Enter → 트레이에 1행 출현,
   카운터 `1 change pending`.
3. 다른 셀 편집 + context-menu → Delete Row → 트레이 2행, 카운터
   `2 changes pending`.
4. 트레이 한 항목의 X 버튼 클릭 → 해당 항목만 사라짐, 카운터 `1` 유지,
   다른 pending 변경에 영향 없음.
5. Toolbar 의 Commit → SQL Preview Dialog 가 열려 동일한 SQL 노출
   (트레이의 SQL 컬럼과 일치).
6. 빈 문자열로 셀 편집 → Enter → 트레이 새값 컬럼이 italic `NULL` +
   hover tooltip "Empty input is treated as SQL NULL".
7. PK 없는 테이블의 SELECT 시도 → analyzeResultEditability 가 read-only
   `<ResultTable>` 로 분기 (defense-in-depth 가드는 도달 불가). Defense
   -in-depth 는 단위 테스트로만 cover.

## Assumptions

- **트레이 위치는 toolbar 와 그리드 본문 사이.** Contract 의 "그리드
  본문의 바로 아래" 표현이 "전체 그리드 컨테이너의 toolbar 직후" 를
  의미하는 것으로 해석 (스크롤 영역이 트레이를 가리지 않도록). AC vitest
  단언은 위치 무관.
- **트레이의 SQL 은 항상 단일 항목 호출로 빌드.** `buildRawEditSql` 를
  `new Map([[key, value]])` / `new Set([rowKey])` 로 호출해 1줄 SQL 을
  만들고 한 행에 표시. SQL Preview Dialog 의 multi-statement 출력과는
  표시 단위가 다르지만 quoting / NULL 매핑은 동일.
- **PK 가드 layer 3 (buildPkWhere 의 빈 WHERE)** 은 단위 테스트
  미포함. DB 엔진의 syntax error 동작이라 mock reproducing 가치 낮음 +
  layer 1·2 가 차단해 도달 불가.

## Residual risk

- **트레이의 5+ 항목 long-list UX** 는 `max-h-48 overflow-y-auto` 로
  스크롤 처리되지만, 100+ 변경 누적 시 사용자 인지 부하. Phase 22 의
  out-of-scope 인 multi-row bulk edit / undo stack 에서 다룰 영역.
- **트레이 SQL 의 "잘릴 만큼 길면 title 로 풀 SQL 노출" 동작**은
  CSS 의 `text-ellipsis whitespace-nowrap` 에 의존. Vitest 는 CSS
  렌더링을 검증하지 않으므로 풀 SQL 의 클립핑/툴팁 동작은 operator
  smoke 에서만 확인 가능.
- **Sprint 183 (Mongo 재배치)** 에서 트레이를 재사용할 때 `RawEditPlan`
  타입 의존성 변환이 필요. 본 sprint 는 RDB 한정이므로 type generics 화
  하지 않았다 (over-engineering 회피).
