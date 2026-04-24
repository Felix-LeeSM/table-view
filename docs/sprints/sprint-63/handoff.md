# Sprint 63 — Generator Handoff (Phase 6 plan A1)

## Changed Files
- `src-tauri/src/db/mod.rs`: 새 trait 계층(`DbAdapter`+`kind`, `RdbAdapter`, `DocumentAdapter`, `SearchAdapter`, `KvAdapter`), DTO(`NamespaceLabel`, `NamespaceInfo`, `RdbQueryResult`, `DocumentId`, `FindBody`, `DocumentQueryResult`, 로컬 `BoxFuture`), 그리고 `ActiveAdapter` enum + accessor(`kind`/`lifecycle`/`as_rdb`/`as_document`/`as_search`/`as_kv`) 선언.
- `src-tauri/src/db/postgres.rs`: 파일 하단에 `impl DbAdapter for PostgresAdapter`(connect/disconnect/ping + `kind() = DatabaseType::Postgresql`)와 `impl RdbAdapter for PostgresAdapter`(기존 concrete 메서드로 얇게 delegate) 블록 추가. 기존 inherent 메서드는 **하나도 수정/삭제되지 않음**.

## Checks Run
- `cd src-tauri && cargo fmt --all` → 적용 완료, 이후 `cargo fmt --all -- --check` 통과 (출력 없음).
- `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` → pass (경고 0).
- `cd src-tauri && cargo test --lib` → **176 passed, 0 failed**.
- `cd src-tauri && cargo test --test schema_integration --test query_integration` → **17 + 14 passed** (DB 연결 가능 환경).
- `pnpm tsc --noEmit` → pass (출력 없음, 오류 0).
- `pnpm lint` → pass (ESLint 오류 0).
- `pnpm vitest run` → **57 files / 1108 tests passed**.

## Done Criteria Coverage
1. **`db/mod.rs`의 trait/DTO/enum**: `DbAdapter`(`kind`, `connect`, `disconnect`, `ping`) 선언 — `mod.rs:101–112`. `RdbAdapter` 전체 메서드 셋(namespace_label/list_namespaces/list_tables/get_columns/execute_sql/query_table_data/drop_table/rename_table/alter_table/create_index/drop_index/add_constraint/drop_constraint/get_table_indexes/get_table_constraints + default 빈 list_views/list_functions + get_view_definition/get_function_source) — `mod.rs:123–235`. `DocumentAdapter` 시그니처 — `mod.rs:239–292`. `SearchAdapter`/`KvAdapter` 빈 body — `mod.rs:296–300`. DTO: `NamespaceLabel`(29–34), `NamespaceInfo`(40–49), `RdbQueryResult`(55), `DocumentId`(64–70), `FindBody`(76–84), `DocumentQueryResult`(88–95). `ActiveAdapter` enum — `mod.rs:310–315`, accessor — `317–370`.
2. **`impl RdbAdapter for PostgresAdapter` 위임 블록**: `postgres.rs:1654–1857`. `list_schemas` → `list_namespaces`(SchemaInfo→NamespaceInfo 변환)로 매핑. `namespace_label()` → `NamespaceLabel::Schema`. `drop_table`/`rename_table`/`get_columns`/`query_table_data`/`get_table_indexes`/`get_table_constraints`는 `(namespace, table)` → `(table, schema)` 순으로 재정렬해 concrete 호출.
3. **기존 concrete 메서드 불변**: `postgres.rs:132–1643`의 inherent `impl PostgresAdapter` 블록은 이번 sprint에서 한 줄도 수정·삭제하지 않음 (trait impl 블록은 별도 블록으로 추가).
4. **AppState/commands/frontend/tests 미변경**: `mod.rs` + `postgres.rs` 외 파일은 수정 없음. `grep`으로 다른 파일 변경 없음 확인 가능.
5. **검증 전부 통과**: 위 Checks Run 섹션 참조.

### `DbAdapter::kind()` 추가 여파
- 기존 코드에 `impl DbAdapter for …`가 하나도 존재하지 않아 파급 0. 새 `impl DbAdapter for PostgresAdapter`에서 `DatabaseType::Postgresql`만 반환하도록 구현.

## Assumptions
- **`AppError::Unsupported` variant는 이번 sprint(63/A1)에서 추가하지 않음.** 마스터 플랜의 힌트대로 `AppState`/command 계층(Sprint 64/A2)에서 `Unsupported`가 실제로 필요해지면 도입. 현재는 `ActiveAdapter::as_rdb/as_document/as_search/as_kv`가 `AppError::Validation`을 반환하게 했다 — `Unsupported`가 가장 자연스럽지만, 기존 variant 중 의미가 가장 가까운 것이 `Validation`이고(연결 paradigm 요건 위반 ⇒ 호출 자체가 잘못된 입력), `Internal`은 "서버측 예기치 않은 오류" 뉘앙스라 부적절하다고 판단. Sprint 64에서 `Unsupported` 도입 시 한 줄 치환만으로 끝나게 현재 코드는 accessor 네 개에만 몰아두었다.
- **`bson` crate는 Sprint 63 시점에 `Cargo.toml`에 존재하지 않음**(실제 확인 결과 `grep`/`Cargo.toml`에 bson 없음). 따라서 `DocumentAdapter`, `FindBody`, `DocumentQueryResult`, `DocumentId`, `insert_document`/`update_document`/`aggregate`의 pipeline 파라미터는 모두 `serde_json::Value`로 선언. 실제 MongoDB 구현(Sprint 65/B)에서 `bson::Document`로 타입을 교체하는 것은 계획된 trait-breaking 변경이다. `DocumentAdapter`는 현재 어떤 타입에도 impl되지 않으므로 파급은 없음.
- 마스터 플랜에서 `RdbAdapter`의 `query_table_data` 시그니처는 `FilterSpec`, `SortSpec` 같은 추상 타입으로 표기되어 있으나, 이번 sprint는 thin delegate가 목표이므로 기존 `PostgresAdapter::query_table_data`가 이미 받고 있는 concrete 타입(`i32`, `Option<&str>`, `Option<&[FilterCondition]>`, `Option<&str>`)을 trait에도 그대로 사용했다. 타입 정규화(`FilterSpec`/`SortSpec` 도입)는 별도 sprint로 분리하는 것이 안전.
- `BoxFuture` 타입 alias는 프로젝트에 `futures` crate 의존성이 없음을 확인한 뒤 `db/mod.rs`에 로컬 선언(`Pin<Box<dyn Future<Output=T>+Send+'a>>`). trait 메서드 본체에서는 가독성을 위해 완전 전개 형태를 유지.
- `ActiveAdapter`와 trait들에 `#[allow(dead_code)]`를 붙인 이유: Sprint 63은 설계만이라 아직 call-site가 없고, Sprint 64/A2에서 wiring 시 자연스럽게 제거될 예정.

## Residual Risk
- **Paradigm 분기 에러를 `Validation`에 올려둔 것**: UI/로깅에서 "입력 검증 실패"로 오인될 수 있다. Sprint 64 시작 시 `AppError::Unsupported` variant를 먼저 추가하고 accessor 4곳을 치환할 것 — 1-commit 수준의 변경.
- **Trait이 concrete 타입(`FilterCondition`, `AlterTableRequest` 등)을 직접 받음**: 향후 MySQL/SQLite adapter가 PostgreSQL과 다른 요청 형태를 필요로 할 경우 trait을 일반화해야 한다. MongoDB는 다른 trait(`DocumentAdapter`)이라 이 위험은 RDB 내부에 국한.
- **이번 sprint(63)에서 수동 smoke는 수행하지 않음** (contract invariants에 따라 Sprint 64/A2 범위). 기존 Postgres 동작은 integration test 스위트로 방벽 확보.

## Generator Handoff

### Changed Files
- `src-tauri/src/db/mod.rs`: paradigm-separated trait/DTO/ActiveAdapter 선언.
- `src-tauri/src/db/postgres.rs`: `impl DbAdapter for PostgresAdapter` + `impl RdbAdapter for PostgresAdapter` (thin delegate) 추가.

### Checks Run
- `cargo fmt --all -- --check`: pass
- `cargo clippy --all-targets --all-features -- -D warnings`: pass
- `cargo test --lib`: pass (176/176)
- `cargo test --test schema_integration --test query_integration`: pass (31/31)
- `pnpm tsc --noEmit`: pass
- `pnpm lint`: pass
- `pnpm vitest run`: pass (1108/1108)

### Done Criteria Coverage
- DC1 (trait/DTO/enum in `db/mod.rs`): 위 섹션 참조 (파일:라인 인용).
- DC2 (`impl RdbAdapter for PostgresAdapter` with list_schemas→list_namespaces mapping, NamespaceLabel::Schema): `postgres.rs:1654–1857`.
- DC3 (기존 concrete 메서드 시그니처 무수정): diff에서 `impl PostgresAdapter { … }` 본체 변경 없음.
- DC4 (AppState/commands/frontend/tests 무수정): 두 파일 외 변경 없음.
- DC5 (검증): 위 Checks Run 전부 통과.

### Assumptions
- `AppError::Unsupported`는 Sprint 64/A2에서 도입, 이번 sprint는 `Validation`으로 임시 대체 (변경 포인트 4곳에 집중).
- `bson` crate 미도입 상태에서 `DocumentAdapter`/관련 DTO의 body 파라미터는 `serde_json::Value`로 선언 (Sprint 65/B에서 `bson::Document`로 이식).
- Trait은 기존 concrete 타입(`FilterCondition`, `*Request`)을 그대로 받아 thin delegate 유지 (FilterSpec/SortSpec 추상화는 별도 sprint).
- `BoxFuture` 로컬 alias 사용 (`futures` crate 미의존).

### Residual Risk
- Paradigm 분기 에러를 `Validation`으로 노출 — UX 문구 오해 가능. Sprint 64 초기에 `Unsupported` 도입으로 해소.
- RDB trait이 Postgres-tied concrete 요청 타입을 사용 → MySQL/SQLite adapter 추가 시 추상화 필요.
- 수동 smoke 미수행 (Sprint 63 out-of-scope), integration tests로 회귀 차단.
