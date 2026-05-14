# Sprint 296 Handoff — Phase 17 Closure (retrospective)

**날짜**: 2026-05-14
**범위**: MySQL adapter testcontainers 통합 합류 + Phase 17 closure
**Sprint sequence**: 276 → 278 → 279 → 280 → 281 → 282 → 283 → 284 → 285
→ 286 → 287 → 288 → 296

## Result: PASS

## 배경

Phase 17 (MySQL 어댑터) 은 2026-05-01 에 "TablePlus 패리티 우선" 정책으로
명목상 보류 결정이 났지만, 실제로는 Sprint 276 부터 본 sprint (sprint-
296) 까지 13 sprint sequence 로 작업이 묻혀 진행됐다. 2026-05-13 Phase
27 종료로 재개 평가 트리거가 발동된 시점에 audit 해보니 모든 Slice 가
이미 wired + coverage 합류까지 완료. 본 핸드오프는 그 retroactive
closure 다.

## Phase 17 Exit Gate

| Gate | Status | Evidence |
|------|--------|----------|
| Skip-zero | PASS | `grep` 0 hit |
| `pnpm vitest run` | PASS | 278 files / 3401 passed | 10 skipped |
| `pnpm tsc --noEmit` | PASS | type errors 0 |
| `pnpm lint` | PASS | ESLint errors 0 |
| Rust unit / 통합 | PASS | `cargo test` (testcontainers gate 합류, sprint-296) |
| Coverage 임계 (line/func/region) | PASS | 84.23 / 79.74 / 85.66 (임계 80 / 74 / 81) |
| ADR 0028 (driver 선택 동결) | PASS | sqlx::mysql 채택, `memory/decisions/0028-mysql-driver-sqlx/memory.md` |
| F-Refactor Part 1/2 (ConnectionConfig variant + DDL DTO) | PASS | Sprint 278~280 |
| MysqlAdapter Slice A (read path) | PASS | Sprint 281 |
| MysqlAdapter Slice B (execute_sql + query_table_data) | PASS | Sprint 282 |
| MysqlAdapter Slice C (stream_table_rows) | PASS | Sprint 283 |
| MysqlAdapter Slice D (DDL mutations) | PASS | Sprint 284 |
| MysqlAdapter Slice E (indexes / constraints) | PASS | Sprint 285 |
| MysqlAdapter Slice F (views / functions / triggers) | PASS | Sprint 286 |
| MysqlAdapter Slice G (DB-level + list_schema_columns) | PASS | Sprint 287 |
| PG ↔ MySQL 1:1 gap audit | PASS | Sprint 288 |
| MySQL DECIMAL decode wire 정규화 | PASS | sprint-296, `sqlx bigdecimal` feature |
| MySQL trigger 메소드 커버리지 | PASS | sprint-296 `list_triggers` / `get_trigger_source` hit |
| PG trait dispatch coverage | PASS | sprint-296 `test_pg_trait_dispatch_covers_rdb_adapter_surface` (340 line) |
| pre-commit / pre-push 임계 일원화 | PASS | sprint-296 — 두 hook 의 측정/임계를 동일 호출로 통일 |
| `test_export_connections_encrypted_round_trip` 결정성 | FIXED (sprint-296) | base64 부분 문자열 어서션 → wrong-password 결정적 검증 (`io.rs:598`) |
| E2E (RISK-036) | DEFERRED | tauri-driver 미설치. Sprint 297 e2e smoke 재구축 후 후속 후보. RISK-036 은 sprint-279 시점에 e2e dead 로 인정됨 — vitest + Rust 통합으로 모방. |

## Sprint 요약

| Sprint | Scope | Outcome |
|--------|-------|---------|
| 276 | 미구현 어댑터 connection-create UI 숨김 | PASS |
| 278 | sqlx mysql feature 활성화 | PASS |
| 279 | MysqlAdapter lifecycle skeleton | PASS |
| 280 | dev env fix: deny RSA + db:up mysql + connections usage | PASS |
| 281 | Slice A — read path + UI surface | PASS |
| 282 | Slice B — execute_sql + query_table_data | PASS |
| 283 | Slice C — stream_table_rows | PASS |
| 284 | Slice D — DDL mutations | PASS |
| 285 | Slice E — indexes / constraints | PASS |
| 286 | Slice F — views / functions / triggers | PASS |
| 287 | Slice G — DB-level + list_schema_columns | PASS |
| 288 | PG ↔ MySQL 1:1 gap audit + 패치 | PASS |
| 296 | testcontainers 통합 합류 + coverage gate 일원화 | PASS |

## 핵심 결정

- **ADR 0028** — sqlx::mysql 채택 (vs mysql_async). 이유: ADR 0001 (sqlx
  단일 stack) 정렬, 의존성 최소, mysql_async 의 비동기 feature 가 우리
  read/write path 에서 미사용. 후속 모니터링: RUSTSEC-2023-0071
  (caching_sha2 RSA), MySQL DECIMAL wire 정규화.
- **HTML5 native DnD 와 같은 외부 lib 회피 정책 정렬** — testcontainers
  의 lazy spawn 만 통합 gate 에 합류, 의존성 추가 없음.

## 후속

- AC-17-E2E (RISK-036 deferred) — Sprint 297 의 e2e smoke 가 안정화된
  시점에 MySQL happy-path smoke spec 추가 후보.
- Phase 18 (MariaDB) — wire-compatible 이므로 본 MysqlAdapter 를 base
  로 dialect flag 또는 별도 adapter 결정 ADR 부터 시작.
- Phase 19 (SQLite) / Phase 20 (Oracle) — 보류 정책 재평가 시점에
  착수 여부 결정.
