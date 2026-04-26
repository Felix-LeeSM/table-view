# Sprint Execution Brief: sprint-131

## Objective

Mongo paradigm의 in-connection DB switch 활성화. Backend `MongoAdapter.switch_active_db` + `DocumentAdapter::switch_database` trait. S130의 `meta.rs` Document arm Unsupported placeholder 교체. 프런트 `DbSwitcher.handleSelect`이 paradigm document일 때 `documentStore.clearConnection` 호출.

## Task Why

S130에서 PG sub-pool LRU 8 + DbSwitcher dispatch가 활성화됐으나 Document paradigm은 placeholder (`Err(Unsupported("...lands in Sprint 131"))`). 본 sprint는 Mongo도 동일한 사용자 시야를 제공 — 하나의 connection 안에서 admin/test 등 다른 db로 전환하면 사이드바 collections 재로딩.

## Scope Boundary

- raw-query DB-change 감지 금지 — S132.
- 단축키 / 신규 e2e spec 금지 — S133.
- DocumentAdapter trait `list_collections(db)` / `find(db, ...)` 시그니처 변경 금지.
- DocumentDataGrid 내부 store wire 시그니처 변경 금지.
- Sub-pool / connection 재활용 금지 — Mongo Client는 multi-db.

## Invariants

- vitest + cargo test 회귀 0.
- e2e 정적 컴파일 회귀 0.
- 사용자 시야 회귀: PG = S130 그대로, Mongo = DbSwitcher 클릭 시 실제 동작, kv/search = disabled 그대로.
- credentials 재입력 없음.
- aria-label 가이드 준수.
- DocumentAdapter trait 기존 시그니처 보존.

## Done Criteria

1. `MongoAdapter` `active_db` 필드 추가 + lifecycle 통합.
2. `MongoAdapter::switch_active_db(db_name)` method + 권한 fallback + 단위 테스트.
3. `DocumentAdapter::switch_database` trait method (default `Err(Unsupported)`) + MongoAdapter override.
4. `meta.rs` Document arm 교체 + dispatch test 갱신.
5. `DbSwitcher.handleSelect`의 paradigm 분기 (rdb → schemaStore.clearForConnection, document → documentStore.clearConnection).
6. `connectionStore` connect path가 mongo paradigm도 activeDb 초기화.
7. 검증 명령 7종 그린.

## Verification Plan

- Profile: `mixed`
- Required checks:
  1. `pnpm vitest run` — 1981+ 그린
  2. `pnpm tsc --noEmit` — 0
  3. `pnpm lint` — 0
  4. `pnpm contrast:check` — 0 새 위반
  5. `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 0 fail
  6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — 0
  7. e2e 정적 컴파일 회귀 0
- Required evidence:
  - 각 AC에 file:line / test:line 매핑
  - MongoAdapter active_db 추가 코드 인용
  - meta.rs Document arm 교체 코드 인용
  - DbSwitcher paradigm clear 분기 코드 인용
  - dispatch test Document arm OK 반환 인용

## Evidence To Return

- Changed files + purpose 한 줄
- 7개 검증 명령 outcome
- AC-01..AC-10 매핑
- 가정 (e.g. "list_database_names 권한 부족 시 silent set + warn log")
- 잔여 위험

## References

- Contract: `docs/sprints/sprint-131/contract.md`
- Master spec: `docs/sprints/sprint-125/spec.md` (S131 항목)
- 직전 sprint findings: `docs/sprints/sprint-130/findings.md`
- Relevant files:
  - `src-tauri/src/db/mongodb.rs` (MongoAdapter — client/default_db)
  - `src-tauri/src/db/mod.rs` (DocumentAdapter trait)
  - `src-tauri/src/commands/meta.rs:86-108` (S130 Document arm placeholder)
  - `src/components/workspace/DbSwitcher.tsx` (S130 handleSelect)
  - `src/stores/connectionStore.ts` (S130 setActiveDb / connect path)
  - `src/stores/documentStore.ts` (clearConnection 이미 존재)
