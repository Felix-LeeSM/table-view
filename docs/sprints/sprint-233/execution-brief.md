# Sprint Execution Brief: sprint-233

## Objective

두 개의 작은 독립 버그를 한 sprint 에서 닫는다:

1. **Bug #1** — `UPDATE schema.table SET ` (특히 `"public"."brief_news_tasks"`
   처럼 schema/table 양쪽이 PG double-quoted) 에서 column 자동완성 popup
   이 뜨지 않는 문제. `useSqlAutocomplete` 의 schema namespace 가
   fully-quoted form (`"schema"."table"`) 를 등록하지 않아
   CodeMirror 의 path resolution 이 column children 까지 도달하지 못하던
   부분을 닫는다.
2. **Bug #2** — DataGrid 하단 "Executed query" 스트립이 plain `<code>`
   로 렌더돼 syntax highlighting 이 전혀 적용되지 않는 문제. 이미 존재하는
   `<SqlSyntax>` 컴포넌트로 교체.

## Task Why

- TablePlus 사용자가 핵심 워크플로우 (RDB raw SQL editor 에서 UPDATE 작성,
  DataGrid 에서 실행된 query 확인) 에서 끊김 없이 전환할 수 있어야 한다.
  현재는 (1) UPDATE 시 column 자동완성 미동작 — 사용자 productivity 저하,
  (2) bottom strip 색상 미적용 — query 가독성 저하 → "내가 뭘 실행했지?"
  scan 시간 증가.
- 두 fix 모두 표면적 변경은 작지만 사용자 매일 만나는 surface 라 ROI 높음.

## Scope Boundary

- **In**: `useSqlAutocomplete.ts` namespace 빌더 + `DataGrid.tsx` 한
  element 교체 + 테스트 갱신/추가.
- **Out**: CodeMirror lang-sql fork (UPDATE alias 추출), Mongo 변경,
  CSS 토큰 신규 정의, manual smoke.

## Invariants

- 다음 파일 diff = 0:
  - `src/components/structure/useDdlPreviewExecution.ts`
  - `src/components/structure/SqlPreviewDialog.tsx`
  - `src/__tests__/cross-window-*.test.tsx`
  - `src/__tests__/window-lifecycle.ac141.test.tsx`
  - `src/stores/{connectionStore,schemaStore,safeModeStore}.ts`
  - `src/lib/safeMode.ts`
  - `src/lib/sql/sqlSafety.ts`
  - `src/components/shared/SqlSyntax.tsx` (consumer 만 추가; body 동결)
  - `src/lib/sql/sqlTokenize.ts` (이미 quoted identifier 정확히 처리;
    검증 후 변경 0)
- Sprint 226-232 frozen file diff = 0.
- 기존 vitest 케이스 회귀 0 (lifecycle 14 번 "displays the executed SQL
  query" 만 split-span 구조에 맞게 단언 형태 갱신).
- 신규 코드 `it.skip`, `eslint-disable`, `any`, silent `catch{}` 금지.

## Done Criteria

1. `useSqlAutocomplete` 가 PG / SQLite dialect 일 때 fully-quoted
   schema-qualified key (`"schema"."table"`) 도 namespace 에 emit.
   동일 colNs 를 가리킴. (AC-233-01, 02)
2. 컬럼 캐시 미스 시에도 namespace 등록은 graceful (빈 children).
   캐시 갱신 시 useMemo 재계산. (AC-233-03)
3. `DataGrid.tsx` bottom strip 이 `<SqlSyntax sql={data.executed_query}
   className="..." />` 로 교체. (AC-233-04)
4. DataGrid 기존 동작 회귀 0. (AC-233-05)
5. 신규 vitest case ≥ 5 PASS. (AC-233-06)
6. 12-check verification plan 모두 PASS. (AC-233-07)

## Verification Plan

- Profile: `mixed`
- Required checks (12):
  1. `pnpm vitest run` PASS
  2. `pnpm tsc --noEmit` exit 0
  3. `pnpm lint` exit 0
  4. `cargo build --manifest-path src-tauri/Cargo.toml` exit 0
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` exit 0
  6. `cargo test --manifest-path src-tauri/Cargo.toml --lib` PASS
  7. `git diff --stat src/components/structure/useDdlPreviewExecution.ts src/components/structure/SqlPreviewDialog.tsx` = 0
  8. `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` = 0
  9. `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts src/stores/safeModeStore.ts src/lib/safeMode.ts src/lib/sql/sqlSafety.ts` = 0
  10. 신규 AC-233-* 케이스 모두 PASS
  11. `grep -nE 'SqlSyntax' src/components/rdb/DataGrid.tsx` ≥ 1 hit
  12. (선택) `pnpm tauri dev` manual smoke
- Required evidence:
  - red-state.log
  - per-check 결과
  - AC ↔ 테스트 매핑

## Evidence To Return

- 변경 파일 + 목적
- 12 check PASS / FAIL
- AC ↔ 테스트 line:file 매핑
- 가정 (CodeMirror lang-sql 의 path resolution 동작 분석)
- 잔존 risk (UPDATE alias inference 라이브러리 한계)

## References

- Contract: `docs/sprints/sprint-233/contract.md`
- Findings: `docs/sprints/sprint-233/findings.md`
- Relevant files:
  - `src/hooks/useSqlAutocomplete.ts:140-275`
  - `src/components/rdb/DataGrid.tsx:495-505`
  - `src/components/shared/SqlSyntax.tsx`
  - `src/lib/sql/sqlTokenize.ts:213-220` (quoted identifier 처리)
  - `node_modules/@codemirror/lang-sql/dist/index.js:507-523` (path
    resolution split-on-dot 동작)
