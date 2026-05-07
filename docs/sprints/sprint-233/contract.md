# Sprint Contract: sprint-233

## Summary

- Goal: 두 개의 작은 독립 버그 수정 — (Bug #1) `UPDATE schema.table SET ...`
  형태 (특히 `"public"."brief_news_tasks"` 처럼 schema/table 양쪽이
  double-quoted 인 경우) 에서 column 자동완성이 동작하지 않던 문제 해결,
  (Bug #2) `DataGrid.tsx` 의 "Executed query" 하단 스트립이 plain
  `<code>` 로 렌더되어 syntax highlighting 이 전혀 적용되지 않던 문제 해결.
- Audience: SQL workflow 사용자 (TablePlus parity).
- Owner: harness Generator (Sprint 233).
- Verification Profile: `mixed` (vitest + tsc + lint + cargo build/clippy/test
  + `git diff --stat` invariants + grep 정합성).

## In Scope

- `src/hooks/useSqlAutocomplete.ts` — schema namespace 빌더 확장.
  Postgres / SQLite double-quote dialect 에서 schema-qualified
  fully-quoted form (`"schema"."table"`) 도 namespace key 로 등록.
- `src/components/rdb/DataGrid.tsx` — 하단 executed-query 스트립의
  plain `<code>` 를 `<SqlSyntax sql={...} />` 로 교체.
- `src/hooks/useSqlAutocomplete.test.ts` — namespace 모양 새 단언 추가.
- `src/components/rdb/DataGrid.lifecycle.test.tsx` — 기존 "displays the
  executed SQL query" 케이스가 split-span 구조에 맞게 갱신되며,
  bottom strip 이 SqlSyntax 로 렌더된다는 새 케이스 추가 (≥ 3 신규).

## Out of Scope

- CodeMirror lang-sql 의 `getAliases` 가 UPDATE 절에서 alias 를
  추출하지 못하는 본질적 한계 — 라이브러리 fork / patch 없이 해결 불가.
  이 sprint 는 namespace key 등록 이외의 라이브러리 동작 변경은 시도하지
  않는다. (사용자가 `"schema"."table"."col"` 처럼 fully-qualify 하면
  컬럼이 surface 된다.)
- Mongo autocomplete 변경.
- DataGrid CSS / 색상 토큰 신규 정의 (`text-syntax-keyword` 등은 이미 존재).
- 라이브 DB 대상 manual smoke (선택).

## Invariants

- `useDdlPreviewExecution.ts` / `SqlPreviewDialog.tsx` diff = 0.
- `cross-window-*.test.tsx` / `window-lifecycle.ac141.test.tsx` diff = 0.
- `connectionStore.ts` / `schemaStore.ts` / `safeModeStore.ts` /
  `safeMode.ts` / `sqlSafety.ts` diff = 0.
- Sprint 226-232 byte-equivalent fixture / frozen file diff = 0.
- `SqlSyntax.tsx` body 변경 0 (단순 consumer 추가만).
- `sqlTokenize.ts` body 변경 0 — `"quoted"."identifier"` 토큰화는
  이미 line 213-220 에서 `identifier` kind 로 정확히 처리됨 (검증 완료).
- 신규 코드에 `it.skip`, `eslint-disable`, `any`, silent `catch{}` 금지.

## Acceptance Criteria

- `AC-233-01` — `useSqlAutocomplete` namespace 가 `"schema"."table"`
  fully-quoted key 를 포함 (PG / SQLite dialect 일 때).
- `AC-233-02` — 동일 key 가 unqualified bare key (`table`) 와 동일한
  컬럼 SQLNamespace 를 가리킴 — 즉 양쪽 path 모두에서 동일 컬럼이 surface.
- `AC-233-03` — 컬럼이 캐시에 없으면 `"schema"."table"` 등록은 빈 children
  으로 진행 (graceful) — 캐시 갱신 후 `useMemo` 재계산으로 컬럼 surface.
- `AC-233-04` — `DataGrid.tsx` bottom strip 이 `<SqlSyntax>` 컴포넌트로
  렌더 — keyword span (`text-syntax-keyword`) 가 SELECT / FROM / LIMIT /
  OFFSET 에 적용되고, `"public"."brief_news_tasks"` 는 identifier 로 (
  string 으로 오인되지 않게) 색칠.
- `AC-233-05` — DataGrid 기존 동작 회귀 0 — column header sort UI /
  pagination / query-pane toggle / 빈 상태 메시지 모두 unchanged.
- `AC-233-06` — ≥ 5 vitest 신규 케이스 (`useSqlAutocomplete` ≥ 2,
  `DataGrid` ≥ 3) — 모두 PASS.
- `AC-233-07` — Sprint 226-232 frozen file diff = 0, `pnpm vitest run`
  / `pnpm tsc --noEmit` / `pnpm lint` / `cargo build` / `cargo clippy
  -D warnings` / `cargo test` 모두 통과.

## Design Bar / Quality Bar

- `useSqlAutocomplete` 확장은 **dialect-aware**: PG / SQLite 만
  `"schema"."table"` 를 emit (MySQL 은 backtick — 동일 패턴이지만 사용자
  보고 표면이 PG 라 PG 우선; 코드 자체는 모든 dialect 에서 quote char 를
  활용해 동일하게 작동). dialect 가 없으면 (legacy path) emit 안 함.
- DataGrid 변경은 **minimal-diff**: 한 element 교체 + import 1 라인.
- 신규 테스트는 사용자 관점 (역할/텍스트/클래스) 으로 단언.
- TDD red→green: 새 테스트 우선 작성 → red 캡처 → 구현 → green.

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 전체 PASS.
2. `pnpm tsc --noEmit` — exit 0.
3. `pnpm lint` — exit 0.
4. `cargo build --manifest-path src-tauri/Cargo.toml` — exit 0.
5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — exit 0.
6. `cargo test --manifest-path src-tauri/Cargo.toml --lib` — PASS.
7. `git diff --stat src/components/structure/useDdlPreviewExecution.ts src/components/structure/SqlPreviewDialog.tsx` — 0.
8. `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` — 0.
9. `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts src/stores/safeModeStore.ts src/lib/safeMode.ts src/lib/sql/sqlSafety.ts` — 0.
10. 신규 AC-233-* 명명된 케이스 모두 PASS.
11. `grep -nE 'SqlSyntax' src/components/rdb/DataGrid.tsx` ≥ 1 hit.
12. 선택: `pnpm tauri dev` 후 manual smoke (UPDATE SET 자동완성 popup +
    bottom strip 색상) — 본 sprint 는 자동화된 unit test 만으로 충족.

### Required Evidence

- Generator must provide:
  - 변경된 파일 목록 + 목적
  - 검증 결과 (per-check PASS/FAIL)
  - AC ↔ 테스트 매핑
  - TDD red 캡처 (`tdd-evidence/red-state.log`)
- Evaluator must cite:
  - 각 PASS 결정에 대한 구체 evidence
  - 누락 / 약한 evidence 는 finding 으로

## Test Requirements

### Unit Tests (필수)

- `useSqlAutocomplete.test.ts` — 신규 ≥ 2 case
  (PG `"schema"."table"` namespace key 존재 + 동일 columns map / SQLite 분기).
- `DataGrid.bottom-query.test.tsx` (or 기존 lifecycle 확장) — 신규 ≥ 3 case
  (SqlSyntax 사용 / keyword span / quoted identifier 분류).

### Coverage Target

- 신규 / 수정 코드 라인 ≥ 70%.
- CI 전체 기준 (line 40% / func 40% / branch 35%) 유지.

### Scenario Tests (필수)

- [x] Happy path — `UPDATE "public"."brief_news_tasks" SET ...` 자동완성
      candidate 노출 (namespace key 존재 검증).
- [x] 에러 / 예외 — 캐시 미스 (컬럼 없음) 시 namespace 는 안전히 빈
      children 로 등록.
- [x] 경계 — schema 가 PK-less / view / mixed-case 모두 cover.
- [x] 회귀 — 기존 lifecycle 14 번 케이스 (executed query 표시) 가 split
      span 구조에 맞게 갱신되며 다른 lifecycle 케이스는 그대로.

## Test Script / Repro Script

1. `pnpm vitest run src/hooks/useSqlAutocomplete.test.ts` — 새 AC-233-01/02
   PASS 확인.
2. `pnpm vitest run src/components/rdb/DataGrid.bottom-query.test.tsx` —
   새 AC-233-04 PASS 확인.
3. `pnpm vitest run` 전체 — 회귀 0.
4. `pnpm tsc --noEmit && pnpm lint` — 정적 검증.
5. `cargo build && cargo clippy -D warnings && cargo test --lib` — 백엔드
   변경이 없어도 회귀 0 확인.

## Ownership

- Generator: harness (Sprint 233).
- Write scope:
  - `src/hooks/useSqlAutocomplete.ts`
  - `src/components/rdb/DataGrid.tsx`
  - `src/hooks/useSqlAutocomplete.test.ts`
  - `src/components/rdb/DataGrid.bottom-query.test.tsx` (신규)
  - `src/components/rdb/DataGrid.lifecycle.test.tsx` (기존 "displays the
    executed SQL query" 케이스 갱신)
  - `docs/sprints/sprint-233/{contract,execution-brief,findings,handoff}.md`
  - `docs/sprints/sprint-233/tdd-evidence/red-state.log`
  - `docs/PLAN.md` row 8 갱신
- Merge order: 단일 sprint commit (orchestrator 가 수행).

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
