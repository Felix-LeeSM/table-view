# Sprint Execution Brief: sprint-137

## Objective

Mongo에서 toolbar로 DB를 swap해도 sidebar collection list가 default DB를 고집하는 stale 버그를 잡는다 (백엔드 `list_collections`가 active db를 따라가도록 수정 + 프런트가 DB 변경 시 캐시 invalidate). 동시에 PG sidebar의 row-count 숫자가 estimate인지 exact인지 사용자가 알 수 있도록 라벨/툴팁을 명확히 한다.

## Task Why

S131에서 Mongo `use_db` 가 들어왔지만, sidebar의 `list_collections` 가 stored default db를 그대로 읽어서 swap 후에도 이전 DB의 컬렉션이 남는다. 사용자 점검(2026-04-27)에서 직접 확인된 버그. PG row count는 `pg_class.reltuples` 추정치인데 사용자가 실제 행 수로 오해할 수 있어 라벨/툴팁 또는 우클릭 exact 액션으로 의미를 명확히.

## Scope Boundary

- 변경 가능: `src-tauri/src/db/mongodb.rs`, `src-tauri/src/commands/`, `src/components/schema/`.
- 변경 금지: ConnectionDialog form, query editor, import/export, sidebar single-click semantics(S136), DBMS shape(S135).
- Mongo collection 스키마 sampling 변경 금지.

## Invariants

- S132 raw-query DB-change 감지 동작 유지.
- DBMS shape(S135), Preview/persist(S136), DisconnectButton(S134) 동작 유지.
- 백엔드 connection_test command 변경 없음.
- 키보드 단축키 유지.

## Done Criteria

1. `mongodb::list_collections`가 `use_db("alpha")` 후 alpha의 컬렉션을 반환. cargo test 동반.
2. `DocumentDatabaseTree`가 active Mongo DB 변경 시 새 DB의 collections를 즉시 fetch + 이전 캐시 invalidate. vitest 동반.
3. PG row count cell에 tooltip OR 우클릭 → exact count 액션 구현 (둘 중 하나, handoff에 선택 명시).
4. 거대 테이블 confirm dialog (옵션 b 선택 시).
5. 7개 verification command 그린.

## Verification Plan

- Profile: mixed
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
  4. `pnpm contrast:check`
  5. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  7. `pnpm exec eslint e2e/**/*.ts`
- Required evidence:
  - 7개 명령 출력 (last 20 lines)
  - cargo test 이름 + vitest test 이름

## Evidence To Return

- 변경 파일 목록
- 7개 verification command 출력
- AC-S137-01..06 증거
- stale 원인(코드 라인) 명시
- 가정/리스크

## References

- Contract: `docs/sprints/sprint-137/contract.md`
- Master spec: `docs/sprints/sprint-134/spec.md` (Phase 10)
- Lesson: `memory/lessons/2026-04-27-workspace-toolbar-ux-gaps/memory.md`
- S131 Mongo use_db: `docs/sprints/sprint-131/handoff.md` (참고)
- S132 raw-query DB-change: `docs/sprints/sprint-132/handoff.md`
- Relevant files (read first):
  - `src-tauri/src/db/mongodb.rs`
  - `src-tauri/src/commands/document/`
  - `src-tauri/src/commands/rdb/` (또는 query.rs)
  - `src/components/schema/DocumentDatabaseTree.tsx` + test
  - `src/components/schema/SchemaTree.tsx` + test
  - `src/components/workspace/DbSwitcher.tsx`
  - `src/stores/connectionStore.ts` (`activeStatuses[id].activeDb`)
  - `src/stores/schemaStore.ts` (`clearForConnection`)
