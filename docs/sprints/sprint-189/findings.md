# Sprint 189 — Findings

## 1. Phase 23 closure refactor 완료

Sprint 188 에서 Phase 23 자체는 종료됐지만 RDB 5 사이트 (DataGrid edit,
EditableQueryResultGrid, ColumnsEditor, IndexesEditor, ConstraintsEditor)
가 inline mode×environment×severity 분기를 hand-roll 하던 잔여물이
남아 있었다. Sprint 189 가 이를 `useSafeModeGate` 로 통일.

이로써 **RDB 5 + Mongo 1 = 6 사이트** 모두 단일 lib pure function
(`decideSafeModeAction` in `src/lib/safeMode.ts`) 을 거친다.

## 2. lib/hook 경계 (D-4)

Sprint 188 의 `useSafeModeGate` 는 hook 안에 decision matrix 가 박혀
있어 React 환경 없이는 단언이 불가능했다 (`renderHook` + store mutate
로 6 case 를 단언). Sprint 189 가 D-4 (`memory/conventions/refactoring/lib-hook-boundary/memory.md`)
를 적용하여 `decideSafeModeAction(mode, environment, analysis)` pure
function 으로 추출.

- lib 테스트 7 case (AC-189-06a) 가 `useSafeModeStore` / `useConnectionStore`
  / `renderHook` / DOM 의존 0 으로 동작.
- hook 테스트는 wiring 3 case 로 축소 (matrix 중복 제거).
- block reason text verbatim assertion 은 lib 테스트로 이동 — 다운스트림
  UI (`queryState.error`, `commitError.message`) 의 copy drift 가드 유지.

## 3. lib sub-grouping (D-6)

`src/lib/` 평면 구조 (30+ 파일) 를 도메인별로 묶음:

- `src/lib/sql/` 신설 — sqlSafety, sqlDialect, sqlDialectKeywords,
  sqlDialectMutations, sqlTokenize, sqlUtils, rawQuerySqlBuilder,
  queryAnalyzer (8 모듈, .ts + .test.ts = 16 파일).
- `src/lib/mongo/` — 기존 mql\* 와 mongoSafety, mongoAutocomplete,
  mongoTokenize 합류 (3 모듈 추가, .ts + .test.ts = 6 파일).
- `src/lib/safeMode.ts` — 단일 파일이므로 sub-folder 만들지 않음
  (D-6 정합성 우선).

git mv 로 history 보존, callsite 28건 + lib 내부 cross-import 일괄 갱신.
behavior change 0.

## 4. DEFAULT_PAGE_SIZE drive-by

`components/rdb/DataGrid.tsx:37` 와 `components/document/DocumentDataGrid.tsx:30`
에 동일 값 `300` 으로 중복 선언돼 있던 `const DEFAULT_PAGE_SIZE` 를
`src/lib/gridPolicy.ts` 단일 위치로 추출. paradigm-agnostic policy.

## 5. "+ safe-mode 테스트 신규" 가정 정정

Contract AC-189-03/04/05 가 ColumnsEditor / IndexesEditor /
ConstraintsEditor 에 "safe-mode 테스트 신규" 를 명시했지만, 정찰 결과
**Sprint 187 baseline 이 이미 5 case (strict block / warn dialog /
confirm flow / cancel flow / non-prod skip) 를 각 editor 에 갖춰 둔
상태**였다. 따라서 Sprint 189 는:

- 신규 테스트 0건.
- 기존 187 assertion (canonical block reason / dialog mount /
  preview_only=false invocation 등) 이 그대로 마이그레이션 검증 단언으로
  기능. 모두 pass.

이 정정은 향후 sprint 가 contract 의 "신규 테스트" 항목을 자동으로
받아들이지 말고 정찰부터 해야 한다는 lessons 추가 (이미
`feedback_test_documentation.md` 영향권).

## 6. block fallback 텍스트 정렬

기존 5 사이트 hand-roll 분기는 `analysis.reasons[0] ?? "dangerous statement"`
(소문자 d) 를 fallback 으로 썼다. Sprint 189 이후 lib canonical 인
`"Dangerous statement"` (대문자 D) 로 통일. 기존 테스트는 reasons[0]
non-empty 케이스만 단언했기에 회귀 0건. lib 테스트 AC-189-06a-7 가
대문자 fallback 의 회귀 가드 역할.

## 7. `pendingConfirm` shape 통일 보류

정찰: `useDataGridEdit` 의 `pendingConfirm.statementIndex` 가
`cancelDangerous → setCommitError` 의 "failed at: K" UI 라우팅에
의미 있게 쓰임. 다른 4 사이트는 `{ reason, sql }` 만 필요.

결정: 통일하지 **않음**. 각 사이트가 component-local state 로 유지.
shape 통일을 위해 useDataGridEdit 에 죽은 컴포넌트별 분기를 추가하면
오히려 응집도가 떨어진다. (Sprint 189 Out of Scope 명시.)

## 8. AC → 테스트 매핑

| AC | 검증 위치 | 케이스 수 |
|----|-----------|-----------|
| AC-189-06a | `src/lib/safeMode.test.ts` (NEW) | 7 (matrix 6 + fallback 1) |
| AC-189-06b | `git mv` evidence + tsc / vitest pass | 0 (refactor) |
| AC-189-06c | `git diff` evidence + grid tests pass | 0 (refactor) |
| AC-189-01 | `useDataGridEdit.safe-mode.test.ts` (Sprint 185+186) | 기존 통과 |
| AC-189-02 | `EditableQueryResultGrid.safe-mode.test.tsx` (Sprint 185+186) | 기존 통과 |
| AC-189-03 | `ColumnsEditor.test.tsx` Sprint 187 describe (a~e) | 기존 5 통과 |
| AC-189-04 | `IndexesEditor.test.tsx` Sprint 187 describe (a~e) | 기존 5 통과 |
| AC-189-05 | `ConstraintsEditor.test.tsx` Sprint 187 describe (a~e) | 기존 5 통과 |

## 9. Sprint 198 종료 후 retire 예정 문서

- `docs/refactoring-plan.md` — Sprint 189–198 sequencing. Sprint 198
  closure 직후 retire.
- `docs/refactoring-smells.md` — frozen snapshot (2026-05-02). 갱신
  안 함. Sprint 198 closure 직후 retire.
- 영속 표준은 `memory/conventions/refactoring/` 팔레스로 이전됨
  (4 sub-room: store-coupling / lib-hook-boundary / hook-api / decomposition).
