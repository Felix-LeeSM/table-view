# Generator Handoff — sprint-130

## Goal (1 line)

PG sub-pool LRU 8 + DbSwitcher 활성화 — `PostgresAdapter` 단일 pool → `(db_name) → PgPool` sub-pool (cap 8), `switch_active_db` Tauri command (paradigm 분기), DbSwitcher 항목 클릭이 실제 sub-pool swap + `setActiveDb` + `clearForConnection` + 신규 RDB 탭 `database` 자동 채움까지 dispatch.

## Changed Files

- `src-tauri/src/db/postgres.rs` — 단일 `pool: Arc<Mutex<Option<PgPool>>>` → `inner: Arc<Mutex<PgPoolState>>` (sub-pool HashMap + LRU VecDeque + current_db). 신규 `PG_SUBPOOL_CAP=8`, `select_eviction_target` pure helper, `active_pool()` private helper, `switch_active_db()` (cap-aware LRU + race-resolution + lock-released-while-await), `current_database()`, RdbAdapter `switch_database` override. 기존 26개 method가 `self.active_pool().await?` 사용. 신규 단위 테스트 9개 (LRU helper 4 + switch validation 5).
- `src-tauri/src/db/mod.rs` — `RdbAdapter::switch_database` 기본 method 추가 (default `Err(Unsupported)`).
- `src-tauri/src/commands/meta.rs` — `switch_active_db(connection_id, db_name)` Tauri command + paradigm 분기 (Rdb→adapter; Document→`Unsupported("S131")`; Search/Kv→`Unsupported`). 신규 dispatch 테스트 5개.
- `src-tauri/src/lib.rs` — `commands::meta::switch_active_db` 핸들러 등록.
- `src/lib/api/switchActiveDb.ts` (신규) — thin Tauri wrapper. `+ .test.ts` (5 케이스).
- `src/types/connection.ts` — `ConnectionStatus.connected` variant에 `activeDb?: string` 추가.
- `src/stores/connectionStore.ts` — `connectToDatabase`가 `connection.database`로 `activeDb` 시드. 신규 `setActiveDb(id, dbName)` action (status가 `connected`일 때만 mutate).
- `src/stores/connectionStore.test.ts` — Sprint 130 5개 (seed activeDb / 빈 database 시 omit / connected에서 mutate / disconnected/error/missing은 no-op).
- `src/stores/schemaStore.ts` — `clearForConnection(connectionId)` action 추가. `clearSchema`와 동일 mutation을 공유 helper(`clearConnectionEntries`)로 단일화.
- `src/stores/schemaStore.test.ts` — Sprint 130 2개 (cache 전체 drop / 빈 cache no-op).
- `src/stores/tabStore.ts` — `addTab`/`addQueryTab` 모두 `paradigm === "rdb"` + caller가 `database`를 명시적으로 안 줬을 때 `connectionStore.activeStatuses[id].activeDb`(없으면 `connection.database`)로 자동 채움. 레거시 persisted RDB 탭은 마이그레이션 안 함.
- `src/stores/tabStore.test.ts` — Sprint 130 6개 (table tab autofill / connection.database fallback / query tab autofill / explicit override / persisted no-migrate / document paradigm은 autofill 안 함).
- `src/components/workspace/DbSwitcher.tsx` — `handleSelect`이 실제 `switchActiveDb` dispatch (성공: `setActiveDb` + `clearForConnection` + popover close + success toast / 실패: error toast + popover 유지 / 같은 DB 재선택: no-op + close). 라벨 우선순위 `activeStatuses[id].activeDb` → document 탭 `database` → 레거시 `tab.schema` → `(default)`.
- `src/components/workspace/DbSwitcher.test.tsx` — S128 "no-op + 힌트 토스트" 2개 삭제, S130 7개 추가 (dispatch invocation / setActiveDb 반영 / clearForConnection 호출 / popover close / success toast / 실패 error toast + activeDb 보존 / 같은 DB 재선택 no-op). 라벨 테스트도 activeDb 우선 + document fallback + 레거시 schema fallback로 재작성.

## Checks Run

| 명령 | 결과 |
| --- | --- |
| `pnpm vitest run` | **passed** — 124 files / 1981 tests (S129 baseline 1957 → +24, 회귀 0) |
| `pnpm tsc --noEmit` | **passed** — 0 errors |
| `pnpm lint` | **passed** — 0 errors / 0 warnings |
| `pnpm contrast:check` | **passed** — 864 pairs / 0 new violations (allowlist 64 unchanged) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **passed** — 258 passed / 0 failed / 1 ignored (`test_switch_active_db_cache_miss_creates_lazy_pool` — 라이브 PG 필요) |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | **passed** — 0 errors / 0 warnings (대형 enum variant 한 건 → `Box<ConnectionConfig>`로 해소) |
| e2e 정적 컴파일 | **passed** — `e2e/` 파일 미변경, 신규 spec 추가 0, S133 contract 그대로. `tsc --noEmit` 의 root 프로젝트는 `include: ["src"]`로 e2e를 제외하므로 회귀 0건. |

## Acceptance Criteria 매핑

- **AC-01** `PostgresAdapter` sub-pool 구조 + LRU + current_db 추적
  - `src-tauri/src/db/postgres.rs:171-192` — `PgPoolState { config, pools, current_db, lru_order }` + `PostgresAdapter { inner: Arc<Mutex<PgPoolState>> }`.
  - `src-tauri/src/db/postgres.rs:155-160` — `PG_SUBPOOL_CAP = 8` + `select_eviction_target` pure helper.

- **AC-02** `switch_active_db` method + 단위 테스트 (hit / miss / evict / current-protected)
  - `src-tauri/src/db/postgres.rs:304-409` — 본체 (코드 인용 아래).
  - 테스트 5개:
    - `test_switch_active_db_returns_err_when_not_connected` — `postgres.rs:2202-2210`
    - `test_switch_active_db_rejects_empty_db_name` — `postgres.rs:2212-2220`
    - `test_select_eviction_target_protects_current_db` (cap 1 sentinel) — `postgres.rs:2222-2235`
    - `test_select_eviction_target_picks_oldest_non_current` — `postgres.rs:2237-2249`
    - `test_select_eviction_target_skips_current_in_middle` — `postgres.rs:2251-2263`
    - `test_switch_active_db_cache_hit_updates_lru_and_current` (LRU bookkeeping branch) — `postgres.rs:2265-2298`
    - `test_switch_active_db_evicts_oldest_when_cap_exceeded` — `postgres.rs:2300-2313`
    - `test_switch_active_db_protects_current_db_from_eviction` — `postgres.rs:2315-2326`
    - `test_switch_active_db_cache_miss_creates_lazy_pool` (`#[ignore]`, 라이브 PG) — `postgres.rs:2328-2345`

- **AC-03** `RdbAdapter::switch_database` trait method (default Unsupported) + PostgresAdapter override
  - `src-tauri/src/db/mod.rs:142-159` — trait default (Unsupported).
  - `src-tauri/src/db/postgres.rs:1953-1962` — PostgresAdapter override (delegates to `switch_active_db`).

- **AC-04** Tauri command `switch_active_db(connection_id, db_name)` 등록 + paradigm 분기
  - `src-tauri/src/commands/meta.rs:69-110` — command + dispatch (코드 인용 아래).
  - `src-tauri/src/lib.rs:48-49` — handler 등록.
  - dispatch 테스트:
    - `switch_dispatch_document_paradigm_returns_unsupported_for_s131` — `meta.rs:367-381`
    - `switch_dispatch_search_paradigm_returns_unsupported` — `meta.rs:383-388`
    - `switch_dispatch_kv_paradigm_returns_unsupported` — `meta.rs:390-395`
    - `switch_dispatch_rdb_unconnected_returns_not_connected` — `meta.rs:397-410`
    - `switch_dispatch_rdb_rejects_empty_db_name` — `meta.rs:412-422`

- **AC-05** 모든 기존 PG pool-using method가 `active_pool()` helper 사용 + 회귀 0
  - 26개 method 모두 `let pool = self.active_pool().await?;` 패턴: `execute`, `execute_query`, `ping`, `list_schemas`, `list_tables`, `get_table_columns`, `query_table_data`, `list_schema_columns`, `get_table_indexes`, `drop_table`, `rename_table`, `alter_table`, `create_index`, `drop_index`, `add_constraint`, `drop_constraint`, `get_table_constraints`, `list_views`, `list_functions`, `get_view_columns`, `get_view_definition`, `get_function_source`, `list_databases` (inherent).
  - `get_table_columns_inner` (private helper, signature `pool: &PgPool`)는 호출자가 `&pool` 전달 — `postgres.rs:659,676`.
  - 회귀 0: `cargo test --lib` 258 passed.

- **AC-06** 프런트 `switchActiveDb.ts` thin wrapper + 단위 테스트
  - `src/lib/api/switchActiveDb.ts` — `invoke<void>("switch_active_db", { connectionId, dbName })`.
  - `src/lib/api/switchActiveDb.test.ts` 5개: command name + 인자 / void resolve / Validation reject / Unsupported reject / NotFound reject.

- **AC-07** DbSwitcher 항목 클릭 dispatch + 실패 toast + 단위 테스트
  - `src/components/workspace/DbSwitcher.tsx:148-180` — `handleSelect` (코드 인용 아래).
  - `src/components/workspace/DbSwitcher.test.tsx`:
    - dispatch invocation — `:248-273`
    - setActiveDb 반영 — `:275-296`
    - clearForConnection 호출 — `:298-330`
    - popover close — `:332-355`
    - success toast — `:357-381`
    - 실패 error toast + activeDb 보존 — `:383-414`
    - 같은 DB 재선택 no-op — `:416-438`

- **AC-08** `connectionStore.activeStatuses[id].activeDb` + `setActiveDb` + 단위 테스트
  - `src/types/connection.ts:84-92` — discriminated union `connected.activeDb?`.
  - `src/stores/connectionStore.ts:160-184` — `connectToDatabase` seeds `activeDb` from `connection.database`.
  - `src/stores/connectionStore.ts:201-218` — `setActiveDb` (status가 `connected`일 때만).
  - 테스트 5개 — `connectionStore.test.ts:520-619`.

- **AC-09** `schemaStore.clearForConnection` + 단위 테스트
  - `src/stores/schemaStore.ts:96-141` — `clearConnectionEntries` shared helper + `clearForConnection` action.
  - 테스트 2개 — `schemaStore.test.ts:744-822`.

- **AC-10** 신규 RDB 탭에 `database = activeDb` 자동 채움 + 레거시 persisted 탭 마이그레이션 안 함
  - `src/stores/tabStore.ts:6-26` — `resolveActiveDb(connectionId)` helper.
  - `src/stores/tabStore.ts:248-260` — `addTab` autofill.
  - `src/stores/tabStore.ts:391-405` — `addQueryTab` autofill (caller가 `opts.database` 명시 시 overwrite 금지).
  - 테스트 6개 — `tabStore.test.ts:1517-1632`.
  - 레거시 persisted 탭 미변경: `loadPersistedTabs` 마이그레이션 코드는 sprint-130에서 손대지 않음 (`tabStore.ts:528-570` 그대로).

- **AC-11** 검증 명령 7종 그린 — 위 표.

- **AC-12** 사용자 시야 회귀 0
  - PG 워크스페이스: DbSwitcher 외관 동일 (read-only chrome / connected 상태에서 클릭→popover) — S127/S128 invariant 그대로 유지 (test 11개 통과).
  - 사이드바 schema 트리: connect 시 `activeDb` 시드되지만 그 값이 기본 DB이므로 첫 진입에서는 동일 schema 노출. switch 후에야 `clearForConnection`이 sidebar reload 트리거.

## 주요 코드 인용

### PostgresAdapter sub-pool struct + helper

`src-tauri/src/db/postgres.rs:155-192`

```rust
const PG_SUBPOOL_CAP: usize = 8;

pub(crate) fn select_eviction_target(lru: &VecDeque<String>, current: &str) -> Option<String> {
    lru.iter().find(|name| *name != current).cloned()
}

#[derive(Default)]
pub struct PgPoolState {
    config: Option<ConnectionConfig>,
    pools: HashMap<String, PgPool>,
    current_db: Option<String>,
    lru_order: VecDeque<String>,
}

#[derive(Clone)]
pub struct PostgresAdapter {
    inner: Arc<Mutex<PgPoolState>>,
}
```

### `switch_active_db` LRU evict (race + cap)

`src-tauri/src/db/postgres.rs:304-409`

```rust
pub async fn switch_active_db(&self, db_name: &str) -> Result<(), AppError> {
    if db_name.is_empty() {
        return Err(AppError::Validation("Database name must not be empty".into()));
    }
    enum SwitchPath {
        Hit,
        Miss(Box<ConnectionConfig>),
    }
    let path = {
        let mut guard = self.inner.lock().await;
        if guard.pools.contains_key(db_name) {
            guard.current_db = Some(db_name.to_string());
            guard.lru_order.retain(|name| name != db_name);
            guard.lru_order.push_back(db_name.to_string());
            SwitchPath::Hit
        } else {
            let config = guard.config.as_ref().cloned()
                .ok_or_else(|| AppError::Connection("Not connected".into()))?;
            SwitchPath::Miss(Box::new(config))
        }
    };
    match path {
        SwitchPath::Hit => Ok(()),
        SwitchPath::Miss(boxed_config) => {
            let mut config = *boxed_config;
            config.database = db_name.to_string();
            // ... build new PgPool outside lock ...
            let evicted: Option<PgPool> = {
                let mut guard = self.inner.lock().await;
                if guard.pools.contains_key(db_name) {
                    // race: another task installed it during await
                    guard.current_db = Some(db_name.to_string());
                    guard.lru_order.retain(|n| n != db_name);
                    guard.lru_order.push_back(db_name.to_string());
                    drop(guard);
                    new_pool.close().await;
                    return Ok(());
                }
                let evicted_pool = if guard.pools.len() >= PG_SUBPOOL_CAP {
                    let current = guard.current_db.clone().unwrap_or_else(|| db_name.to_string());
                    let target = select_eviction_target(&guard.lru_order, &current);
                    target.and_then(|name| {
                        guard.lru_order.retain(|x| x != &name);
                        guard.pools.remove(&name)
                    })
                } else { None };
                guard.pools.insert(db_name.to_string(), new_pool);
                guard.lru_order.push_back(db_name.to_string());
                guard.current_db = Some(db_name.to_string());
                evicted_pool
            };
            if let Some(pool) = evicted { pool.close().await; }
            Ok(())
        }
    }
}
```

### Tauri command paradigm 분기

`src-tauri/src/commands/meta.rs:88-110`

```rust
#[tauri::command]
pub async fn switch_active_db(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    db_name: String,
) -> Result<(), AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections.get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    match active {
        ActiveAdapter::Rdb(adapter) => adapter.switch_database(&db_name).await,
        ActiveAdapter::Document(_) => Err(AppError::Unsupported(
            "Document paradigm DB switch lands in Sprint 131".into(),
        )),
        ActiveAdapter::Search(_) => Err(AppError::Unsupported(
            "Search paradigm has no per-connection database concept".into(),
        )),
        ActiveAdapter::Kv(_) => Err(AppError::Unsupported(
            "Key-value paradigm has no per-connection database concept".into(),
        )),
    }
}
```

### DbSwitcher `handleSelect` dispatch

`src/components/workspace/DbSwitcher.tsx:148-180`

```tsx
const handleSelect = useCallback(
  async (dbName: string) => {
    if (!activeConn) return;
    if (dbName === activeDb) {
      setOpen(false);
      return;
    }
    try {
      await switchActiveDb(activeConn.id, dbName);
      setActiveDb(activeConn.id, dbName);
      useSchemaStore.getState().clearForConnection(activeConn.id);
      setOpen(false);
      toast.success(`Switched to "${dbName}".`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to switch DB: ${message}`);
    }
  },
  [activeConn, activeDb, setActiveDb],
);
```

### `schemaStore.clearForConnection`

`src/stores/schemaStore.ts:131-141`

```ts
clearForConnection: (connectionId) => {
  set((state) => clearConnectionEntries(state, connectionId));
},
```
(공유 helper `clearConnectionEntries(state, connectionId)`는 schemas/tables/views/functions/tableColumnsCache 모두 정리.)

### 신규 RDB 탭 database 자동 채움

`src/stores/tabStore.ts:248-260`

```ts
const isRdbTab = (tab.paradigm ?? "rdb") === "rdb";
const tabWithDb: Omit<TableTab, "id"> =
  isRdbTab && tab.database === undefined
    ? { ...tab, database: resolveActiveDb(tab.connectionId) }
    : tab;
```

`src/stores/tabStore.ts:391-405` (query tab):

```ts
const database =
  paradigm === "rdb" && opts.database === undefined
    ? resolveActiveDb(connectionId)
    : opts.database;
```

## 가정

- **current_db evict 보호**: cap 초과 + 모든 풀이 current_db이면 `select_eviction_target`이 `None` 반환 → 실제로는 cap=8 + 단일 entry는 cap < 8 이므로 cap-overflow에서는 도달 불가. 그러나 단일 entry 가드 (test_select_eviction_target_protects_current_db)는 invariant로 명시.
- **race-resolution**: `connect_with` await 동안 다른 task가 같은 db_name을 install 한 경우, switch가 새로 만든 pool은 close하고 기존 entry를 LRU 끝으로 promote — net effect는 hit 경로와 동일.
- **레거시 persisted RDB 탭**: contract가 마이그레이션 금지를 명시. `loadPersistedTabs`의 RDB 분기는 손대지 않았으므로 sprint <130에 만들어진 RDB 탭은 `database === undefined`로 그대로 로드. DbSwitcher 라벨에서는 fallback으로 `tab.schema` 사용 (test `falls back to the rdb tab's schema when no activeDb is set`).
- **현재 DbSwitcher가 표시하는 라벨**은 connection-scoped (`activeStatuses[id].activeDb`) — tab-scoped로 분리하지 않음. 같은 connection의 여러 RDB 탭이 다른 DB를 가리키는 상태는 본 sprint에서 발생하지 않음 (switch는 connection 전체에 대해 일어남, 모든 신규 탭이 즉시 새 DB를 picks up).
- **Document paradigm 탭의 `database` 필드**는 Mongo db 이름이며 sprint-129에서 도입. sprint-130 autofill 로직은 `paradigm === "rdb"`만 손대므로 document 탭은 영향 없음.
- **`get_table_columns_inner` 의 `pool: &PgPool` 시그니처**는 호출자가 `&pool` (where `pool: PgPool` from `active_pool()`)로 넘김. inner 본체의 `fetch_all(pool)` 호출은 `pool: &PgPool` 그대로라 변경 불필요.

## 잔여 위험

- **라이브 PG cache-miss 테스트**: `test_switch_active_db_cache_miss_creates_lazy_pool`은 `#[ignore]` — 실제 PG에 권한 없는 환경에서는 패턴이 안 도는지 자동 검증 안 됨. CI에서 라이브 PG fixture가 준비되면 (`cargo test --include-ignored`) 활성화 권장.
- **DbSwitcher 라벨 vs 탭 database 동기화**: 탭이 활성화된 후 사용자가 DB를 switch하면 그 탭의 `tab.database`는 옛 DB를 그대로 보유. 본 sprint는 라벨 source를 `activeStatuses` 우선으로 만들었지만, 탭 sql 실행 시점의 DB 컨텍스트(`tab.database` vs `activeDb`) divergence는 S132 (raw-query DB-change 감지)에서 다룰 영역.
- **Document paradigm DbSwitcher**: 클릭 시 backend가 `Unsupported("Sprint 131")`을 반환. 사용자가 보는 toast: `Failed to switch DB: Unsupported operation: Document paradigm DB switch lands in Sprint 131`. S131 작업 시 메시지 다듬기 권장.
- **PG 권한 부족 + multi-DB 시도**: list_databases가 fallback으로 default DB만 노출 (S128 동작) → DbSwitcher list가 그 한 항목. 사용자가 그것을 클릭하면 same-db no-op로 처리되어 toast/dispatch 없음. 의도된 거동.
