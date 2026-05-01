# Sprint 189 — Handoff

Sprint: `sprint-189` (Phase 23 closure refactor — RDB 5 사이트 →
`useSafeModeGate` 통일 + `decideSafeModeAction` lib 추출 + lib
sub-grouping + `DEFAULT_PAGE_SIZE` 단일화).
Date: 2026-05-02.

## Files changed

| 파일 | Purpose |
|------|---------|
| **NEW** `src/lib/safeMode.ts` | `SafeMode` type + `SafeModeDecision` + `decideSafeModeAction(mode, environment, analysis)` pure function. lib React/store 의존 0 (D-1 준수). |
| **NEW** `src/lib/safeMode.test.ts` | 7 cases (`AC-189-06a-1~7`) — matrix 6 cell + fallback 1. Block reason text verbatim 단언. |
| `src/hooks/useSafeModeGate.ts` | decision matrix 제거, `decideSafeModeAction` 위임. store wiring 만 남김. |
| `src/hooks/useSafeModeGate.test.ts` | 6 case → 3 wiring case 로 축소. matrix 단언은 lib 테스트로 이전. |
| `src/stores/safeModeStore.ts` | `SafeMode` type 을 lib 에서 import + 재export (backward compat). |
| **NEW** `src/lib/gridPolicy.ts` | `DEFAULT_PAGE_SIZE = 300` 단일 export. `rdb/DataGrid` + `document/DocumentDataGrid` 양쪽이 import. |
| `src/lib/sql/*` (이전) | 8 모듈 (sqlSafety, sqlDialect, sqlDialectKeywords, sqlDialectMutations, sqlTokenize, sqlUtils, rawQuerySqlBuilder, queryAnalyzer) `git mv src/lib/ → src/lib/sql/`. |
| `src/lib/mongo/*` (이전) | 3 모듈 (mongoSafety, mongoAutocomplete, mongoTokenize) `git mv src/lib/ → src/lib/mongo/`. 기존 mql\* 와 동거. |
| `src/components/datagrid/useDataGridEdit.ts` | `useSafeModeStore` + `useConnectionStore` 직접 select 제거 → `useSafeModeGate(connectionId)` 단일 hook. block / confirm 분기 통합 loop. `statementIndex` 보존. |
| `src/components/query/EditableQueryResultGrid.tsx` | 동일 마이그레이션. `connectionEnvironment` 는 production stripe 배너용으로 별도 select 유지. |
| `src/components/structure/ColumnsEditor.tsx` | 동일 마이그레이션. previewSql `;` split → 각 sub-statement gate. |
| `src/components/structure/IndexesEditor.tsx` | 동일 (DROP INDEX 분기). |
| `src/components/structure/ConstraintsEditor.tsx` | 동일 (DROP CONSTRAINT 분기). |
| `src/components/rdb/DataGrid.tsx` | 로컬 `DEFAULT_PAGE_SIZE` 삭제, `@lib/gridPolicy` import. |
| `src/components/document/DocumentDataGrid.tsx` | 동일. |
| `src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` | 코멘트 1줄 갱신 (참조 위치 명시). |
| `src/components/datagrid/useDataGridEdit.ts` 외 28 callsite | `@lib/<module>` / `@/lib/<module>` 경로를 `sql/` / `mongo/` sub-dir 로 일괄 갱신. |
| `docs/sprints/sprint-189/contract.md` | Sprint 189 contract (AC-189-01~06c). |
| `docs/sprints/sprint-189/findings.md` | 본 sprint findings (9 섹션). |
| `docs/sprints/sprint-189/handoff.md` | 본 파일. |

총 코드 ~50 modified + 3 new (lib + test + gridPolicy) + 22 moved (`git mv`) = 큰 변경, docs 3 신설.

## AC 별 evidence

| AC | 검증 | 증거 |
|----|------|------|
| AC-189-06a | `pnpm vitest run src/lib/safeMode.test.ts` | **7 passed** (NEW). |
| AC-189-06b | `git log --diff-filter=R src/lib/sql/ src/lib/mongo/` + `pnpm tsc --noEmit` | rename evidence + tsc 0 errors. |
| AC-189-06c | `pnpm vitest run src/components/rdb/DataGrid src/components/document/DocumentDataGrid` | **4 files / 101 passed**. |
| AC-189-01 | `pnpm vitest run src/components/datagrid/useDataGridEdit` | **12 files / 118 passed** (safe-mode + 11 다른 동작 baseline 무영향). |
| AC-189-02 | `pnpm vitest run src/components/query/EditableQueryResultGrid` | 기존 safe-mode + 일반 테스트 모두 통과. |
| AC-189-03/04/05 | `pnpm vitest run src/components/structure/{Columns,Indexes,Constraints}Editor.test.tsx` | Sprint 187 describe (a~e) × 3 = 15 cases 모두 통과. |
| Sprint 189 전체 | `pnpm vitest run` + `tsc` + `lint` + `git diff src-tauri/` | **182 files / 2644 tests passed**; tsc 0; lint 0; src-tauri/ empty. |

## Required checks (재현)

```sh
pnpm vitest run src/lib/safeMode.test.ts \
  src/hooks/useSafeModeGate.test.ts \
  src/components/datagrid/useDataGridEdit \
  src/components/query/EditableQueryResultGrid \
  src/components/structure
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
git diff --stat src-tauri/
```

기대값: 모두 zero error / empty diff.

## 후속 (sequencing 계속)

- **Sprint 190 (FB-1b)**: prod-auto SafeMode (사용자 toolbar 조작 없이
  production 태그 연결에 자동 strict 적용). `decideSafeModeAction` 의
  default 정책 추가 또는 store 의 mode 초기값 분기.
- **Sprint 191** (refactor): SchemaTree 분해 (A-3 / A-5).
- **Sprint 192** (FB-3): DB 단위 export.
- **Sprint 193** (refactor): useDataGridEdit 자체 분해 — Sprint 189 가
  store coupling 만 정리. 본문 1000+ 라인의 commit pipeline / dirty
  tracking / pending state 를 sub-hook 으로 쪼갠다.
- 단건 mutate 정책 (Sprint 188 finding §2 carry) 은 여전히 미결.
