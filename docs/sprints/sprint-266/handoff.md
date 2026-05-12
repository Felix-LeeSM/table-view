# Sprint 266 Handoff — RDB `execute_query` 의 `expected_database` 가드

## Status

Complete. RDB 실행 경로의 backend db-mismatch race 를 opt-in 가드로 차단.
Sprint 263 OoS #3 + Sprint 264 OoS #2 의 비대칭 (Document 는 explicit,
RDB 는 implicit) 을 wide migration 없이 minimal-correct 로 좁힘.

## Acceptance Criteria — verification

| AC | 결과 |
|---|---|
| AC-266-01 `AppError::DbMismatch` variant | ✅ `src-tauri/src/error.rs` — named struct variant `{ expected, actual }` 으로 추가, `to_string()` 직렬화 그대로 |
| AC-266-02 `execute_query_inner` 사전 검증 | ✅ Optional `expected_database: Option<&str>` 받음. `None` 이면 기존 경로, `Some` 이면 lock 안에서 `current_database()` fetch + 비교 + mismatch → `DbMismatch`. Cancel token 도 short-circuit 시 release |
| AC-266-03 `execute_query_batch_inner` mirror | ✅ 동일 패턴. batch 시작 시점 1회만 검증 (mid-batch `USE other_db` 는 unguarded per spec) |
| AC-266-04 Tauri command + frontend opt-in | ✅ 2 Tauri command sig 에 `expected_database: Option<String>` 추가. `executeQuery / executeQueryBatch` wrapper 가 optional `expectedDatabase` 받음 (tauri 의 camelCase ↔ snake_case 자동 변환). `useQueryExecution` 의 `runRdbSingleNow` / `runRdbBatchNow` 가 `workspaceDb` forward |
| AC-266-05 회귀 가드 | ✅ vitest 258 files / 3195 tests passed, tsc clean, lint clean, cargo clippy clean, cargo test 673 passed (+6 vs Sprint 265 baseline) |

## 주요 production 변경

| 파일 | 변경 |
|---|---|
| `src-tauri/src/error.rs` | `AppError::DbMismatch { expected, actual }` named struct variant 추가 |
| `src-tauri/src/commands/rdb/query.rs` | `execute_query_inner` + `execute_query_batch_inner` 가 `Option<&str>` 받음. lock 안에서 `current_database()` sample + 비교 → mismatch 시 `DbMismatch` 반환 (`execute_sql` 호출 전). cancel token 도 short-circuit 시 release. Tauri command sig 에 `expected_database: Option<String>` 추가 |
| `src/lib/tauri/query.ts` | `executeQuery` / `executeQueryBatch` 가 optional 4번째 인자 `expectedDatabase` 받음. `?? null` 로 Tauri invoke 에 전달 (Option<String> 역직렬화 호환) |
| `src/components/query/QueryTab/useQueryExecution.ts` | `runRdbSingleNow` + `runRdbBatchNow` 가 `workspaceDb` 를 forward. 둘 다 useCallback 의 deps array 에 `workspaceDb` 포함 |

## 테스트

### Backend (`cargo test`) — 6 신규 케이스

- `execute_query_expected_db_mismatch_returns_dbmismatch` — adapter 의 active db 가 다를 때 `DbMismatch { expected, actual }` 반환. `execute_sql` 은 panic stub — 가드 누설 즉시 감지.
- `execute_query_expected_db_match_executes_normally` — 매치하면 정상 실행.
- `execute_query_expected_db_none_skips_check_backwards_compat` — `None` 이면 `current_database_fn` 이 probe 되지 않음 (panic stub). pre-Sprint-266 fast-path 보존.
- `execute_query_expected_db_mismatch_releases_cancel_token` — short-circuit 시에도 token 누수 없음.
- `execute_query_batch_expected_db_mismatch_returns_dbmismatch` — batch path mirror.
- `execute_query_batch_expected_db_match_executes_normally` — batch path 정상 실행.

### Frontend (vitest) — 5 assertion 업데이트

기존 assertion 들이 `mockExecuteQuery.toHaveBeenCalledWith(...)` 의 4번째
positional arg (`expectedDatabase`) 를 받도록 `expect.any(String)` 한 칸
추가:

- `QueryTab.lifecycle.test.tsx` — 단일 SELECT 실행 케이스
- `QueryTab.toolbar.test.tsx` — Run 버튼 trigger 케이스
- `QueryTab.warn-dialog.test.tsx` — AC-255-03b UPDATE WHERE 케이스
- `QueryTab.execution.test.tsx` — multi-statement 2-call 케이스
- `QueryTab.safe-mode.test.tsx` — AC-231-02b 2-statement confirm 케이스

신규 frontend 단위 테스트는 추가하지 않음 — `executeQuery` wrapper 는 thin
shim (invoke pass-through) 이고 위 5 통합 케이스가 실제 forward 를 검증.

## Out of Scope (Sprint 267+ 후보)

spec.md §Out of Scope 와 동일:

1. **나머지 RDB command 의 가드** — `list_schemas`, `list_tables`,
   `get_table_columns`, `execute_query_dry_run`, `query_table_data`,
   `get_table_indexes`, `get_table_constraints` 등. Schema introspection
   은 race 가 있어도 데이터 무결성 영향이 작아 우선순위 낮음.
2. **Document RDB-style migration** — 이미 `database` explicit, 적용 불요.
3. **`switch_active_db` 자체의 race 제어** — DbSwitcher UI 가 loading
   state 로 후속 input 을 직렬화하므로 별 sprint.
4. **`AppError::DbMismatch` 의 UX 처리** — 현재는 generic error toast
   로 surface. 전용 retry/refresh flow 가 필요한지는 사용자 피드백 후
   판단.

## Lessons

- **Opt-in 가드 → wide migration 회피** — 60+ Tauri command 에 `database`
  를 일괄 추가하는 대신 핵심 실행 경로 2개에만 opt-in `expected_database`
  를 도입. 회귀 0 (`None` 이면 기존 fast-path), 점진적 채택 가능. `Option`
  type 이 Rust+TS 양쪽에서 backwards-compat 를 자연스럽게 표현.
- **Lock 안에서 sample + compare** — adapter 의 `current_database()` 가
  default impl 인 경우 `execute_sql("SELECT current_database()")` 로
  round-trip 할 수 있어 lock 을 두 번 잡으면 race 가 다시 열림. 한
  acquisition 안에서 sample → compare → execute 셋 다 수행해야 가드가
  의미를 가짐.
- **Panic stub 으로 "호출되면 안 되는 경로" 검증** — `current_database_fn`
  / `execute_sql_fn` 을 panic 으로 stub 하면 가드가 누설될 때 즉시 test
  failure. assertion 만으로는 "조건부로 호출 안 되었다"를 검증하기 어려운
  케이스에서 효과적.
- **camelCase ↔ snake_case 자동 변환** — Tauri 의 default invoke 직렬화가
  `expectedDatabase` (JS) ↔ `expected_database` (Rust) 변환을 자동
  처리. wrapper 에서 별도 mapping 필요 없음.
- **`workspaceDb` 가 이미 RDB tab 의 active db 해석을 갖고 있음** —
  `useQueryExecution:125-128` 에서 `tab.database ?? resolveActiveDb(...)`
  로 한 번만 계산. Sprint 266 의 forward 가 이 기존 useMemo 결과를 그대로
  재사용 — 추가 derive 없이 opt-in 완료.
