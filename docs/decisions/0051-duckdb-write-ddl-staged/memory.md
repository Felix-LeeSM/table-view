---
id: 0051
title: DuckDB write/DDL 개방 — RDB parity 완전체를 PR 단위로 스테이징 (ADR 0046 보완)
status: Accepted
date: 2026-07-10
supersedes: null
superseded_by: null
---

**결정**: DuckDB 를 read-only 분석 전용에서 **write/DDL 가능**으로 개방한다 (2026-07-10, 오너 결정). 최종 목표는 **RDB parity 완전체** — 그리드 row 편집 + DDL + dry-run/트랜잭션이 다른 파일 기반 RDB(SQLite)와 동등해지는 상태다. 본 ADR 은 ADR 0046(data source profile / capability architecture)이 DuckDB 를 RdbAdapter spine 으로 확장한다고만 정하고 write/DDL paradigm 개방 여부는 열어 둔 지점을 여는 후속이며 supersede 가 아니다 (그 "개방은 별도 새 ADR 대상" 프레이밍은 0046 본문이 아니라 이슈 #1070 감사에서 제기됨) — 0046 의 RdbAdapter spine·capability 게이팅 결정은 그대로 유효하고, 본 ADR 은 그 위에서 DuckDB 의 capability 를 어디까지 켤지를 규정한다. 구현은 한 번에 하지 않고 **PR 단위로 스테이징**한다:

- **Stage 1 — 그리드 row 편집**: capability `edit.editRows` 를 flip 하고, 편집 쓰기를 `execute_sql_batch` / `enforce_single_row_effect` (`src-tauri/src/db/mod.rs`) 경유로 태운다. 구현 템플릿은 SQLite 의 `src-tauri/src/db/adapters/sqlite/batch.rs`. UI 게이트는 #1468 의 `supportsRowEditing` 헬퍼로 일원화 — `read_only` 로 열린 연결은 편집 UI 를 비노출한다.
- **Stage 2 — DDL**: `src-tauri/src/db/duckdb.rs` 의 schema-change 스텁 10 개(`drop_table` / `rename_table` / `alter_table` / `add_column` / `drop_column` / `create_table` / `create_index` / `drop_index` / `add_constraint` / `drop_constraint`, 전부 `duckdb_unsupported(...)` 반환)를 실구현하고 capability `ddl.*` 를 flip 한다.
- **Stage 3 — dry-run / multi-statement 트랜잭션**: `dry_run_sql_batch` 롤백을 구현해 destructive preview 를 SQLite 와 동등하게 만든다. 이 단계 완료 시 RDB parity 완전체 도달.

**부수 결정 (4)**:

1. **`read_only` 기본값 유지**. 편집은 opt-in — 사용자가 연결을 `read_only=false` 로 명시적으로 열어야 write 가 활성된다. 외부 도구(Python / DuckDB CLI)와의 파일 lock 공존 안전을 발견성보다 우선한다.
2. **외부 동시 접근 충돌 = 현행 "즉시 실패 + 명확한 에러" 유지**. DuckDB 는 single-writer 라 재시도/대기가 무의미하다. 단 lock 충돌 에러를 사용자가 이해할 UX 안내는 Stage 별 개선 대상.
3. **연결 수명 = 현행 connection-per-call 유지**. 세션 지속 write 연결은 채택하지 않는다 — single-writer lock 을 상시 점유하면 외부 도구가 영구 배제되기 때문.
4. **batch 원자성 = 한 클로저 안 `BEGIN..COMMIT`**. connection-per-call 위에서 batch 는 단일 클로저 안에서 트랜잭션으로 감싸 원자성을 확보한다(Stage 1 의 `execute_sql_batch` 경로).

**이유**:

1. **일관성 결여 해소 (SQLite parity)**. 같은 "파일 기반 로컬 RDB" 인 SQLite 는 이미 그리드 편집·DDL 이 가능한데 DuckDB 만 막혀 있다 — 같은 paradigm 인데 UX 가 갈린다. 일관성 원칙(같은 작업 = 같은 진입점)에 어긋난다.
2. **breadth-first 제품 방향 정합**. DuckDB 유지 결정(ADR 0047)을 내린 이상, read-only 결손을 남기는 것보다 parity 로 끌어올리는 것이 방향과 맞다.
3. **[사실 정정] free-form SQL 은 이미 write 가능하다**. #1070 본문의 "`AccessMode::ReadOnly` 고정(`duckdb/connection.rs:491`)" 은 부정확하다. 실측상 `src-tauri/src/db/duckdb/connection.rs:500-504` 는 `settings.read_only` 조건부이고, `read_only=false` 로 열면 이미 `AccessMode::ReadWrite` 라 free-form SQL 의 `INSERT`/`UPDATE`/`DDL` 이 실행된다. 진짜 갭은 AccessMode 가 아니라 **구조화된 편집·DDL·preview 경로가 막혀 있음** 이다: ① 그리드 편집이 타는 `execute_sql_batch` / `dry_run_sql_batch` 가 DuckDB 에서 trait default `Unsupported` 를 상속(`src-tauri/src/db/traits.rs:239,256` — "does not support batched transactions" / "does not support dry-run"), ② `duckdb.rs` 의 schema-change 스텁 10 개가 `duckdb_unsupported`, ③ UI capability profile 이 `edit`/`ddl` 전부 false, ④ `src/components/rdb/DataGrid.tsx:97` 의 read-only 가드가 `dbType === "sqlite"` 로 하드코딩돼 DuckDB 를 태우지 않는다. 즉 "free-form 은 이미 되나 구조화 편집/DDL/preview 경로가 막혀 있다".
4. **안전 논거**. `read_only` 기본값 opt-in + single-writer 즉시 실패는, 외부 프로세스가 같은 파일을 열고 있을 때 앱이 lock 을 조용히 강탈하거나 무한 대기하지 않게 한다.

**트레이드오프**:
- **+** SQLite 와 편집/DDL/preview UX 가 수렴 — DataGrid·Safe Mode·destructive preview·충돌 감지가 이미 있는 RdbAdapter 경로를 그대로 재사용, DuckDB 전용 쓰기 경로를 새로 만들 필요 없음.
- **+** capability 기반 게이팅이라 미구현 stage 는 runtime error 가 아니라 UI 비노출로 드러난다(ADR 0046 원칙 상속). Stage 승격 = capability flip.
- **−** single-writer lock ↔ 외부 도구 공존이 근본 긴장. `read_only=false` 연결이 열려 있는 동안 외부 Python/CLI 가 write lock 을 못 잡는다(역도 성립) — 부수결정 1·2 로 완화하되 제거는 불가.
- **−** opt-in `read_only` 의 발견성. 기본값이 read-only 라 사용자가 편집 UI 가 왜 안 보이는지 모를 수 있다 — read-only 표현은 #1052(구현은 #1468)가, lock 충돌 UX 안내는 Stage 별 개선이 담당.
- **−** 스테이징으로 인한 중간 상태. Stage 1 후에는 "그리드 row 편집은 되나 DDL 은 안 됨" 이 정상 상태다. capability 게이팅이 이를 명시적으로 노출하므로 혼란은 UI 로 흡수되지만, parity 완전체는 Stage 3 까지 미도달.
- **시나리오**:
  - ① `read_only=false` DuckDB 연결에서 그리드 셀 편집 → `execute_sql_batch` `BEGIN..COMMIT` 한 클로저, `enforce_single_row_effect` 로 다중행 영향 차단(Stage 1).
  - ② 외부 CLI 가 같은 `.duckdb` 를 write 로 점유 중 → 앱의 write 연결 open 이 즉시 실패 + 명확한 에러(부수결정 2). 재시도/대기 없음.
  - ③ read-only 연결 → `supportsRowEditing` false → 편집 UI 비노출(#1468). AccessMode 는 ReadOnly.
- **재개 트리거**: 구현은 미착수 — 본 ADR 은 결정만 동결한다. 3 stage 각각 별도 PR 로 승격. Tracker: issue #1070.

**관련**:
- issue #1070 — 구현 tracker(open 유지). 본문의 "AccessMode::ReadOnly 고정" 서술은 부정확 — 정정 comment 참조.
- issue #1052 — DuckDB read-only 표현(구현은 #1468 이 `supportsRowEditing` 헬퍼로 처리, read-only 연결 편집 비노출).
- issue #1469 — 5-adapter single-row 가드 균일화. DuckDB 의 Stage 1 batch 도 이 `enforce_single_row_effect` 가드를 경유한다.
- ADR 0046 — data source profile / capability architecture. 0046 은 DuckDB 를 RdbAdapter spine 으로 확장한다고만 정했고(write/DDL 개방 여부는 미결정), 본 ADR 이 그 지점을 여는 후속이며 supersede 아님 — "별도 새 ADR" 프레이밍 출처는 이슈 #1070. 0046 본문 동결 유지.
- ADR 0047 — DuckDB 지원 유지(제거 보류). read-only parity 결손(#1052 / #1070 / #1106)을 미해결로 남긴다고 명시한 지점을 본 ADR 이 해소 경로로 전환.
- `src-tauri/src/db/adapters/sqlite/batch.rs` — Stage 1 구현 템플릿(파일 기반 RDB batch write 참조 구현).
- `src-tauri/src/db/duckdb.rs` — schema-change 스텁 10 개(Stage 2 실구현 대상) + `duckdb_unsupported` 헬퍼.
- `src-tauri/src/db/duckdb/connection.rs:500-504` — `settings.read_only` 조건부 AccessMode(사실 정정 근거).
- `src-tauri/src/db/traits.rs:239,256` — `execute_sql_batch` / `dry_run_sql_batch` trait default `Unsupported`(DuckDB 미구현 상속).
- `src/components/rdb/DataGrid.tsx:97` — read-only 편집 가드(현재 sqlite 하드코딩, capability 로 일원화 대상).
