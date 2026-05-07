# Sprint 233 — Handoff

Date: 2026-05-07.
Owner: harness Generator.

## Summary

두 개의 작은 독립 버그를 한 sprint 에서 닫음 (사용자 보고 2026-05-07):

1. **Bug #1** — `useSqlAutocomplete` 가 `"public"."brief_news_tasks"`
   같은 PG fully-quoted schema-qualified key 를 namespace 에 emit 하지
   않아, CodeMirror 의 path resolution 이 column children 까지 도달하지
   못하던 부분. `addFullyQuotedAlias` helper 추가로 fix
   (`src/hooks/useSqlAutocomplete.ts:237-263`).
2. **Bug #2** — DataGrid 하단 "Executed query" strip 이 plain `<code>`
   로 syntax highlighting 이 전혀 없던 부분. 이미 존재하는
   `<SqlSyntax>` 컴포넌트로 1-element 교체 + import 1 라인
   (`src/components/rdb/DataGrid.tsx:29, 502-510`).

## Files Changed

| File | Purpose |
| --- | --- |
| `src/hooks/useSqlAutocomplete.ts` | `addFullyQuotedAlias` helper 추가 (line 237-263); tables / views 루프에서 호출 (line 282, 296). PG/SQLite/MySQL dialect 가 있을 때만 emit (legacy path 무영향). |
| `src/components/rdb/DataGrid.tsx` | `import SqlSyntax` 추가 (line 29); bottom-strip `<code>` → `<SqlSyntax>` 교체 (line 502-510). |
| `src/hooks/useSqlAutocomplete.test.ts` | Sprint 233 describe block 추가 — 3 신규 케이스 (AC-233-01/02/03). |
| `src/components/rdb/DataGrid.bottom-query.test.tsx` | 신규 파일 — 4 케이스 (AC-233-04 a/b/c/d). |
| `src/components/rdb/DataGrid.lifecycle.test.tsx` | 14번 케이스 ("displays the executed SQL query") 단언을 split-span 구조에 맞게 갱신 (회귀 의미 보존). |
| `docs/sprints/sprint-233/contract.md` | Phase 2 Contract artifact. |
| `docs/sprints/sprint-233/execution-brief.md` | Phase 2 Generator brief. |
| `docs/sprints/sprint-233/findings.md` | 진단 / 트레이드오프 / 잔존 risk. |
| `docs/sprints/sprint-233/handoff.md` | (이 파일) Generator self-report. |
| `docs/sprints/sprint-233/tdd-evidence/red-state.log` | RED 상태 7 fail 캡처. |
| `docs/PLAN.md` | Row 8 → ✓ 갱신 (Sprint 233 entry). |

## Acceptance Criteria

| AC | Test name | File:line | Result |
| --- | --- | --- | --- |
| AC-233-01 (PG fully-quoted key) | `emits a fully-quoted schema-qualified key for PG dialect (AC-233-01)` | `useSqlAutocomplete.test.ts:444-491` | PASS |
| AC-233-02 (SQLite backtick) | `emits a fully-quoted schema-qualified key for SQLite dialect (AC-233-02)` | `useSqlAutocomplete.test.ts:495-528` | PASS |
| AC-233-03 (캐시 미스 graceful) | `registers fully-quoted key with empty children when columns are not cached (AC-233-03)` | `useSqlAutocomplete.test.ts:535-559` | PASS |
| AC-233-04 (a) (SqlSyntax wiring) | `renders the executed query through SqlSyntax with keyword token spans (AC-233-04)` | `DataGrid.bottom-query.test.tsx:117-130` | PASS |
| AC-233-04 (b) (keyword 색상) | `colorizes SELECT, FROM, LIMIT, OFFSET as keywords (AC-233-04)` | `DataGrid.bottom-query.test.tsx:135-148` | PASS |
| AC-233-04 (c) (PG quoted identifier) | `classifies PG double-quoted identifiers as identifiers, not strings (AC-233-04)` | `DataGrid.bottom-query.test.tsx:155-180` | PASS |
| AC-233-04 (d) (number 색상) | `colorizes LIMIT / OFFSET numeric arguments as numbers (AC-233-04)` | `DataGrid.bottom-query.test.tsx:185-194` | PASS |
| AC-233-05 (DataGrid 회귀 0) | `pnpm vitest run` 전체 PASS (lifecycle 14번 갱신은 의미 보존) | `DataGrid.lifecycle.test.tsx:209-217` (수정) + 220 / 2853 PASS | PASS |
| AC-233-06 (≥ 5 신규 case) | useSqlAutocomplete +3 (38→41) + DataGrid bottom-query +4 = 7 신규 | n/a | PASS |
| AC-233-07 (Sprint 226-232 invariant) | git diff --stat = 0 on frozen files; 4-set verification 통과 | check #7-9 | PASS |

Test-count delta: vitest 220 files / 2846 → 221 / 2853 (+1 file, +7 cases).
Cargo: 379 / 379 (변경 없음).

## Verification Plan Checklist (12 checks)

| # | Check | Result |
| --- | --- | --- |
| 1 | `pnpm vitest run` | PASS — 221 files / 2853 tests / 0 failed |
| 2 | `pnpm tsc --noEmit` | PASS — exit 0, silent |
| 3 | `pnpm lint` | PASS — exit 0, silent |
| 4 | `cargo build --manifest-path src-tauri/Cargo.toml` | PASS — `Finished dev profile … in 0.69s` |
| 5 | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | PASS — `Finished dev profile … in 0.35s`, 경고 0 |
| 6 | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | PASS — 379 passed, 0 failed, 2 ignored |
| 7 | `git diff --stat src/components/structure/useDdlPreviewExecution.ts src/components/structure/SqlPreviewDialog.tsx` | PASS — 0 |
| 8 | `git diff --stat src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/cross-window-store-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` | PASS — 0 |
| 9 | `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts src/stores/safeModeStore.ts src/lib/safeMode.ts src/lib/sql/sqlSafety.ts` | PASS — 0 |
| 10 | 신규 AC-233-* 케이스 7건 모두 PASS | PASS — 7/7 |
| 11 | `grep -nE 'SqlSyntax' src/components/rdb/DataGrid.tsx` | PASS — 3 hits (import + comment + element) |
| 12 | (선택) `pnpm tauri dev` manual smoke | 미수행 (자동화 테스트로 충족) |

추가 invariant 확인:

- `git diff --stat src/components/shared/SqlSyntax.tsx src/lib/sql/sqlTokenize.ts` = 0 (consumer 만 추가, 본문 동결).

## TDD Evidence

`docs/sprints/sprint-233/tdd-evidence/red-state.log` — 7 fail 캡처 :

- `useSqlAutocomplete.test.ts` 3 fail (AC-233-01/02/03 — "expected
  to have property" 단언 실패; namespace key 부재 확인).
- `DataGrid.bottom-query.test.tsx` 4 fail (AC-233-04 a/b/c/d — span
  query 결과가 빈 배열, plain `<code>` 의 token span 부재 확인).

`addFullyQuotedAlias` 추가 + DataGrid `<code>`→`<SqlSyntax>` 교체 후
동일 명령 재실행 → 7/7 GREEN.

## Frontend / Backend Change Audit

- 백엔드 (`src-tauri/`) 변경 0. cargo test 379/0 그대로.
- 프론트엔드 변경 surface 가 좁음:
  - `useSqlAutocomplete.ts` — helper 1 개 + 2 호출 (table/view 루프).
  - `DataGrid.tsx` — import 1 라인 + element 교체 (1 element).
- 다른 SQL editor surface (Mongo / Document / SchemaTree DDL preview)
  무영향 — 검증 명령에서 회귀 0.

## Assumptions

1. CodeMirror lang-sql `addNamespaceObject` (line 507-523) 의 `.` split
   동작은 안정적 — `node_modules/@codemirror/lang-sql/dist/index.js`
   소스를 직접 확인.
2. `quoteCharForDialect` 의 fallback (`'"'`) 이 dialect 가 부재할 때
   안전 — 테스트 `omits quoted aliases entirely when no dialect is
   supplied` 가 지켜주므로 회귀 0.
3. `sqlTokenize.ts:213-220` 의 `"…"` → identifier 분기는 PG 의 standard
   quoted identifier 동작을 정확히 표현. 새 AC-233-04 (c) 가 명시적으로
   고정.

## Residual Risk

1. **UPDATE alias 라이브러리 한계**: CodeMirror lang-sql 의 `getAliases`
   가 FROM only walk → `UPDATE table SET <CURSOR>` 에서 column 자동완성
   surface 안 됨. 본 sprint 의 namespace fix 는 `SET "schema"."table".
   "col"` 처럼 fully-qualify 한 path 만 살린다. 완전 fix 는 라이브러리
   fork / 별도 SQL parser 도입 필요 (별도 sprint 후보).

2. **MySQL backtick 검증 부재**: `quoteCharForDialect(MySQL)` 이 backtick
   을 반환하므로 helper 가 `` `db`.`table` `` 형태도 emit 하지만 본
   sprint 는 PG 보고 닫기 위한 케이스만 명시 단언. MySQL surface 는
   다음 sprint 에서 같은 패턴으로 추가 가능.

3. **mixed-case schema name + fully-quoted form** 조합: 단일 helper 가
   양쪽을 quote 해서 처리하므로 동작은 안전하지만 explicit 테스트 부재.
   필요 시 Sprint 234 polish 에 흡수 가능.

## Final State

- 7 acceptance criteria 모두 충족 (5 직접 vitest + 2 검증 명령 합성).
- 12 verification check 모두 PASS (12번 manual smoke 만 선택 미수행).
- TDD evidence 보존 (`red-state.log`).
- Frontend diff 좁음 — 핵심 file 2 + 테스트 file 3.
- 백엔드 diff 0.
- `docs/PLAN.md` row 8 → ✓ 갱신 + row 9 placeholder (Sprint 234) 추가.

orchestrator review 준비 완료.
