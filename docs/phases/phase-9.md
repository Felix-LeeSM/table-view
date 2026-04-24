# Phase 9: MySQL + SQLite 지원

> 추가 RDB 어댑터 + RDB trait 일반화 — **계획**

## 배경 / 판단 기준

Phase 1~5에서 PostgreSQL이 first-class로 구현됐고 Phase 6에서 paradigm-separated trait(`RdbAdapter`/`DocumentAdapter`/…)이 도입되었다. 그러나 현재 `RdbAdapter`는 PostgreSQL concrete 타입(`AlterTableRequest`, `FilterCondition`, `ConnectionConfig { host, port, … }`)을 그대로 받아 **Postgres-shaped**이다. MySQL과 SQLite를 실제로 꽂으려면 이 shape이 먼저 일반화돼야 한다.

판단 기준: "TablePlus 사용자가 Postgres 워크플로우(탐색/조회/편집/쿼리)를 MySQL·SQLite 연결에서도 끊김 없이 반복할 수 있는가." 방언 차이는 어댑터 내부에서 흡수하고, UI 경험은 동일해야 한다.

## 전제(Phase 6에서 이미 갖춰진 것)

- `DbAdapter`/`RdbAdapter` trait 계층 + `ActiveAdapter` enum dispatch
- `NamespaceLabel::{Schema, Database, Single}` 추상화
- `make_adapter` factory 패턴

## 구현 항목

| Feature | ID | 우선순위 | 비고 |
|---------|-----|---------|------|
| RDB trait 일반화 (DDL DTO, ConnectionConfig polymorphism) | F-Refactor | P0 | MySQL/SQLite 선행 블로커 |
| MySQL 연결 폼 (host/port/socket/SSL/charset) | F1.1 확장 | P0 | |
| MysqlAdapter 구현 (`sqlx::mysql` 또는 `mysql_async`) | — | P0 | |
| MySQL database 사이드바 (`SHOW DATABASES` → 테이블) | F2.1 확장 | P0 | `NamespaceLabel::Database` |
| MySQL 조회/DDL/인덱스/제약 | F2.3/F3/F-DDL 공통 | P0 | 방언 흡수 |
| MySQL Views / Stored Procedures / Functions / Triggers | F2.8 확장 | P1 | 트리거는 PG에는 없음 — 선택적 확장 |
| SQLite 파일 connection (file path + 읽기 전용 모드) | F1.1 확장 | P0 | host/port 없는 모델 |
| SqliteAdapter 구현 (`sqlx::sqlite`) | — | P0 | |
| SQLite 단일 namespace(`main`) + attached DB | F2.1 확장 | P0 | `NamespaceLabel::Single` |
| SQLite 조회/DDL 제약 처리(제한된 ALTER TABLE) | F-DDL 확장 | P0 | 미지원 기능은 UI에서 disabled |
| 타입 매핑 추상화 (PG/MySQL/SQLite → 공통 display/edit type) | — | P1 | 편집 경로 cast/literal 생성기 분리 |
| 방언별 SQL preview (DROP TABLE, ALTER TABLE) | — | P1 | SQL Preview 모달 dialect-aware |

## F-Refactor: RDB trait 일반화 (선행 리팩터)

현재 PG-shaped 타입을 추상화한다. Phase 6 Sprint 63 handoff의 residual risk 해소 지점.

- [ ] `ConnectionConfig`에 variant 구조 도입
  - PG/MySQL: `Host { host, port, user, password, database, socket?, ssl? }`
  - SQLite: `File { path, readonly }`
  - serde는 tag 기반 직렬화(`kind` 필드)
- [ ] DDL 요청 DTO 추상화
  - `AlterTableOp` enum (AddColumn, DropColumn, RenameColumn, ChangeType, SetNotNull, SetDefault, …)
  - 각 adapter가 enum variant를 방언 SQL로 materialize
  - PG 전용 기능(CHECK, EXCLUSION constraint)은 `Extended { kind, payload }`로 escape hatch
- [ ] `FilterSpec`/`SortSpec` 추상화
  - 현재 `Option<&[FilterCondition]>` / `Option<&str>`을 공통 DTO로
  - 각 adapter가 placeholder 표기(`$1` vs `?`), quoting, 함수명을 번역
- [ ] 타입 매핑 trait
  - `trait TypeMapper { fn display_type(&self, native: &str) -> String; fn literal(&self, value: &Value, native_type: &str) -> String; }`
  - PG: `pg_cast_type` 기반, MySQL/SQLite는 각자 구현
- [ ] 기존 PG 경로 회귀 0 (integration tests로 방벽)

## F1.1 확장: MySQL 연결 폼

- [ ] `ConnectionConfig.kind = "mysql"`
- [ ] 필드: Host/Port(3306)/User/Password/Database(optional)
- [ ] 옵션: Unix socket path, SSL mode(DISABLED/PREFERRED/REQUIRED/VERIFY_CA/VERIFY_IDENTITY), charset(utf8mb4 기본)
- [ ] `mysql://...` URI import
- [ ] Test Connection → `SELECT VERSION()` 노출

## F1.1 확장: SQLite 연결 폼

- [ ] `ConnectionConfig.kind = "sqlite"`
- [ ] 필드: Database file path (file picker), Read-only 토글
- [ ] `sqlite://path` URI import
- [ ] Test Connection → 파일 존재/열기 가능 여부 + `SELECT sqlite_version()`

## F-MysqlAdapter

- [ ] `src-tauri/src/db/mysql.rs` — `impl RdbAdapter for MysqlAdapter`
- [ ] `namespace_label() = NamespaceLabel::Database`
- [ ] `list_namespaces()` = `SHOW DATABASES` (시스템 DB 토글 필요: `mysql`, `information_schema`, `performance_schema`, `sys`)
- [ ] Views, Stored Procedures, Functions, Triggers 메서드 구현
- [ ] AUTO_INCREMENT, ENGINE, CHARSET 메타 노출

## F-SqliteAdapter

- [ ] `src-tauri/src/db/sqlite.rs` — `impl RdbAdapter for SqliteAdapter`
- [ ] `namespace_label() = NamespaceLabel::Single { name: "main" }`
- [ ] `list_namespaces()` = `["main"]` + `ATTACH`된 DB
- [ ] 제한된 ALTER TABLE: DROP/RENAME COLUMN(3.35+), CHANGE TYPE 불가 → UI disabled
- [ ] Functions/Procedures 미지원 → default 빈 impl로 처리
- [ ] WAL mode, FOREIGN KEY pragma 상태 표시

## 위험 & 트레이드오프

- **Trait 일반화 리팩터의 blast radius**: 기존 PG 경로가 전부 통과하는 것을 integration test로 방벽. 추상화 타입을 지나치게 설계하면 "Postgres specific" 기능을 죽이게 됨 → `Extended { kind, payload }` escape hatch로 완화.
- **MySQL 시스템 DB 노출 정책**: 기본 hide + 토글로 노출. TablePlus와 동일한 기본값.
- **SQLite WAL/attached DB**: 파일 단위 모델이 host/port 모델과 충돌. connection 모델 variant 도입으로 근본 해결.
- **타입 매핑 비용**: 3종 × display/edit 매핑은 규모가 커짐. display만 먼저, edit는 P1.

## 검증

각 스프린트 공통:
- `cargo fmt && cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test --lib` + 해당 DBMS integration test
- `pnpm vitest run && pnpm tsc --noEmit && pnpm lint`

Phase 전체:
- `docker compose -f docker-compose.test.yml up -d postgres mysql` + SQLite 파일 fixture
- 세 연결 모두에서 탐색/조회/편집/쿼리 워크플로우 수동 smoke
- PG 회귀 0

## 스프린트 분해(초안)

1. **F-Refactor-A**: `ConnectionConfig` variant + factory 대응
2. **F-Refactor-B**: `AlterTableOp`/`FilterSpec`/`SortSpec` + PG adapter 재배선
3. **F-Refactor-C**: `TypeMapper` trait + PG impl
4. **MySQL-A**: MysqlAdapter 연결 + list_namespaces + 테스트 인프라
5. **MySQL-B**: 조회/편집 경로 + dialect DDL
6. **MySQL-C**: Views/Procedures/Functions/Triggers
7. **SQLite-A**: SqliteAdapter + 파일 connection
8. **SQLite-B**: 제한된 DDL 처리 + WAL/attached DB UI

Phase 9 전체: 약 8 스프린트 예상. Phase 6·7·8 완료 후 착수.
