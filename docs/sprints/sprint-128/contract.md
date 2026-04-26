# Sprint Contract: sprint-128

## Summary

- **Goal**: 백엔드 통합 command `list_databases(connection_id) -> Vec<DatabaseInfo>` 도입. paradigm 별 분기 — RDB(PG) `SELECT datname FROM pg_database WHERE datistemplate=false`, Document(Mongo) 기존 `list_databases` 재사용, 기타 paradigm은 빈 배열 (Unsupported 안 던짐). 프런트엔드 `<DbSwitcher>`가 enable되면 클릭 시 목록 fetch + 표시 — **선택 동작은 여전히 no-op (S130/S131 활성)**. PG `pg_database` 권한 부족 시 현재 DB 단일 항목 폴백.
- **Audience**: Claude Code Generator agent.
- **Owner**: harness orchestrator
- **Verification Profile**: `mixed` (vitest + tsc + lint + contrast + cargo test + clippy + e2e 정적)

## Background (이미 잡힌 사실)

- `DocumentAdapter::list_databases` 이미 존재 (`src-tauri/src/db/mod.rs:251`, mongo 구현 `src-tauri/src/db/mongodb.rs:241`).
- `RdbAdapter` trait엔 `list_namespaces` (= schemas)만 있고 `list_databases`는 없음. 추가 필요.
- 기존 Tauri command `list_mongo_databases`(`commands/document/browse.rs:53`)가 Mongo-전용으로 노출되어 있음. 통합 command 도입과 별개로 기존 command는 보존 (다른 사용처 있음).
- S127에서 `<DbSwitcher>`가 read-only로 마운트됐고 `aria-disabled="true"`. S128은 enable + click → fetch + popover 표시까지.
- `ActiveAdapter::Rdb / Document / Search / Kv` 4-variant enum (`src-tauri/src/db/mod.rs:315`). 4개 모두 paradigm 분기 필요.

## In Scope

### 백엔드
- `RdbAdapter::list_databases(&self) -> BoxFuture<Result<Vec<NamespaceInfo>, AppError>>` 신규 trait method.
  - 기본 구현 = `Ok(Vec::new())` (현재 단일 RDB만 있고 SQLite/MySQL은 Phase 9, 빈 배열 안전).
  - PostgresAdapter 구현 = `SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname`.
  - 권한 부족(`SQLSTATE 42501` 또는 `permission denied for table pg_database`) → `current_database()` 단일 fallback.
- 신규 Tauri command `list_databases(connection_id) -> Vec<DatabaseInfo>`:
  - `commands/connection.rs` 또는 신규 `commands/meta.rs`에 배치 (얇은 dispatch).
  - paradigm 분기: `Rdb → list_databases() (default impl Vec::new() OK)`, `Document → list_databases()`, `Search/Kv → Ok(vec![])`.
  - 반환 타입은 기존 `DatabaseInfo { name: String }` 재사용.
- `tauri::generate_handler![…]`에 새 command 등록.
- 기존 `list_mongo_databases`는 **deprecate 안 함** — 호출 사이트들이 그대로 동작해야 한다 (회귀 0).

### 프런트엔드
- `src/lib/api/listDatabases.ts` 또는 동급: `invoke('list_databases', { connectionId })` thin wrapper.
- `<DbSwitcher>` 변경:
  - paradigm이 `rdb`이거나 `document`이면 enabled (otherwise 기존 disabled 유지).
  - 클릭 → fetch (loading state) → popover/select에 목록 노출.
  - 빈 결과 (e.g. SQLite) → "—" 또는 disabled state 유지.
  - 사용자가 항목 선택 → **현재는 no-op** (S130/S131에서 활성). 시각적 hover는 동작.
  - 선택 시 toast or inline hint: "Switching active DB lands in sprint 130".
  - active tab paradigm 변경 시 캐시 invalidate 또는 fetch 재요청.
  - **active tab의 connection이 disconnected**면 disabled.
- 단순 LRU/캐시는 도입하지 마라 — fetch는 click 마다(또는 popover open당). 캐시는 S130에서.

## Out of Scope

- 실제 DB 전환 (PG sub-pool / Mongo `use_db`) → S130/S131.
- LRU 캐시, sub-pool 키 확장 → S130.
- raw-query DB-change 감지 → S132.
- SQLite/MySQL `list_databases` 구체 구현 (Phase 9 어댑터 도입 시).
- DocumentSidebar 정합 → S129.

## Invariants

- 기존 vitest 1934개 모두 그린.
- 기존 cargo test 회귀 0건.
- `cargo clippy --all-targets --all-features -- -D warnings` 통과.
- `list_mongo_databases` Tauri command 시그니처/동작 보존.
- 기존 e2e 시나리오 회귀 0건.
- `RdbAdapter` trait 확장은 default impl로 — 기타 RDB 구현체가 컴파일 깨지지 않도록.
- 기존 store(connectionStore / tabStore / schemaStore) public API 변경 금지.
- ActiveAdapter::Search/Kv variant 추가됐다고 가정하고 분기를 빼먹지 말 것 (graceful empty return).
- aria-label / role 보존.
- 백엔드 connection pool 시그니처 변경 금지 (S130 분리).

## Acceptance Criteria

- `AC-01` `RdbAdapter` trait에 `list_databases` 메서드 추가, 기본 구현은 `Ok(Vec::new())`.
- `AC-02` `PostgresAdapter::list_databases`가 `SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname` 실행, 정렬된 `Vec<NamespaceInfo>` 반환.
- `AC-03` PG 권한 부족(SQLSTATE 42501 또는 동급 메시지) → `current_database()` 단일 항목 fallback. 단위 테스트로 커버.
- `AC-04` 신규 Tauri command `list_databases(connection_id)` 등록, paradigm 분기 4개 모두 처리 (rdb / document / search / kv → 후 2개는 빈 배열).
- `AC-05` `tauri::generate_handler![…]` 매크로에 `list_databases` 추가, 호출 시 정상 invoke.
- `AC-06` `list_mongo_databases` 동작/시그니처 회귀 0 (기존 호출 사이트 그대로).
- `AC-07` 프런트엔드 thin wrapper(`src/lib/api/listDatabases.ts` 또는 동급)에 `listDatabases(connectionId)` export, 단위 테스트.
- `AC-08` `<DbSwitcher>`는 paradigm이 rdb 또는 document일 때 enabled. 클릭 → fetch → popover/select 노출 (loading state 표시).
- `AC-09` `<DbSwitcher>`에서 항목 선택은 **no-op + inline hint** ("Switching active DB lands in sprint 130" 또는 동급). 단위 테스트로 검증.
- `AC-10` paradigm이 kv/search이거나 active connection이 disconnected이면 `<DbSwitcher>`는 기존 read-only 유지 (`aria-disabled="true"`).
- `AC-11` 신규 단위/통합 테스트:
  - Rust unit (PostgresAdapter): `list_databases` happy + 권한 부족 fallback (mock 또는 통합 환경 변수 가드).
  - TypeScript: `<DbSwitcher>` fetch on click, loading, error toast, empty result, no-op selection.
- `AC-12` 검증 명령 모두 그린:
  - `pnpm vitest run` (1934+)
  - `pnpm tsc --noEmit`
  - `pnpm lint`
  - `pnpm contrast:check`
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib` (통과)
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  - 기존 e2e 정적 컴파일 회귀 없음.

## Design Bar / Quality Bar

- `<DbSwitcher>` UI: 기존 disabled trigger와 같은 footprint — 활성화돼도 layout shift 0.
- 로딩 인디케이터: `<Spinner size="xs">` 또는 trigger 안 dot.
- 에러: 콘솔 silent 금지. inline error chip 또는 toast (existing pattern 재사용).
- aria-label: `[aria-label="Active database switcher"]` (기존 read-only 텍스트 갱신).
- a11y: 활성 시 keyboard navigable, Esc로 popover 닫힘, 첫 항목 자동 focus.
- 권한 fallback 시 사용자 시야엔 "단일 DB" + tooltip 힌트 — 다음 sprint들 위해 silent fail 금지.
- Rust: `pg_database` 권한 부족은 일반적인 PG cloud 환경에서 흔함. 메시지 매칭은 SQLSTATE 우선, 메시지 fallback은 case-insensitive substring.

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 1934+ 그린 (기존 1934 + 신규).
2. `pnpm tsc --noEmit` — 0.
3. `pnpm lint` — 0.
4. `pnpm contrast:check` — 0 새 위반.
5. `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 통과.
6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — 통과.
7. e2e 정적 컴파일 무회귀.

### Required Evidence

- Generator must provide:
  - 변경된 파일 + 의도 한 줄
  - 7개 검증 명령 outcome (Rust 포함)
  - AC-01..AC-12 매핑(file:line / test:line)
  - 통합 command의 paradigm 분기 코드 인용
  - PG 권한 fallback 로직 코드 인용
  - 프런트엔드 fetch on click 코드 인용
- Evaluator must cite:
  - 각 AC pass/fail의 구체 evidence
  - PG fallback이 실제 SQLSTATE/메시지에 매칭되는지 검증
  - `<DbSwitcher>` 선택이 진짜 no-op인지 (스토어 mutation 없음) 단언
  - paradigm kv/search 호출이 빈 배열 반환하는지 (Unsupported 안 던지는지) Rust 테스트

## Test Requirements

### Unit Tests (필수)
- `PostgresAdapter::list_databases`:
  - happy path (mock 또는 도커 PG 통합)
  - 권한 부족 → 단일 fallback
- `commands/.../list_databases` dispatcher:
  - rdb / document / search / kv 4 분기
  - 비-connected connection_id → `AppError::NotFound`
- 프런트엔드 `<DbSwitcher>`:
  - paradigm rdb + connected → enabled, 클릭 시 popover open + 목록 표시
  - paradigm document → enabled, 동일 동작
  - paradigm kv/search → 기존 read-only 유지
  - active connection disconnected → 기존 read-only 유지
  - 항목 클릭 → no-op (스토어 mutation 0), inline hint 노출
  - fetch 실패 → 에러 노출, 라벨은 기존 표시 유지

### Coverage Target
- 신규 코드 (Rust + TS): 라인 80% 이상.

### Scenario Tests (필수)
- [ ] Happy: PG connection에서 list_databases → 여러 DB 표시
- [ ] Happy: Mongo connection에서 list_databases → 여러 DB 표시
- [ ] 에러: 비-connected id → NotFound
- [ ] 경계: PG `pg_database` 권한 부족 → 단일 fallback
- [ ] 경계: SQLite/MySQL/ES/Redis paradigm → 빈 배열
- [ ] 회귀: 기존 list_mongo_databases 호출 사이트 그대로 동작

## Test Script / Repro Script

1. `pnpm install` (lockfile 변경 없으면 skip)
2. `pnpm vitest run`
3. `pnpm tsc --noEmit`
4. `pnpm lint`
5. `pnpm contrast:check`
6. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
7. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`

## Ownership

- Generator: harness general-purpose agent
- Write scope:
  - `src-tauri/src/db/mod.rs` (RdbAdapter trait method 추가)
  - `src-tauri/src/db/postgres.rs` (구현)
  - `src-tauri/src/commands/connection.rs` 또는 신규 `commands/meta.rs` (통합 command)
  - `src-tauri/src/lib.rs` (handler 등록)
  - `src/lib/api/` (TS wrapper)
  - `src/components/workspace/DbSwitcher.tsx` (enabled 분기 + fetch on click)
  - 신규 *.test.tsx / *.test.ts
  - **금지**: connection pool 시그니처 변경, raw-query lex, 단축키, 신규 e2e
- Merge order: 단일 commit `feat(workspace): list_databases meta command + DbSwitcher fetch (sprint 128)`

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes (Rust 포함)
- Acceptance criteria evidence linked in `handoff.md`
- 기존 vitest 1934 + Rust suite 회귀 없음
