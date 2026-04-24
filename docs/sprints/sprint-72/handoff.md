# Sprint 72 Handoff — Phase 6 plan E-1 (Backend aggregate + aggregate_documents command)

## Status: READY FOR EVALUATION

Generator-scope 6 checks 전부 PASS, AC-01 ~ AC-12 전부 증거 확보. Docker MongoDB 컨테이너가 기동 중이어서 두 개의 신규 aggregate 통합 테스트도 실제 파이프라인 실행으로 녹색 (fallback skip 경로도 여전히 유지).

## Changed Files

| File | Purpose |
|---|---|
| `src-tauri/src/db/mongodb.rs` | `MongoAdapter::aggregate` 의 `Unsupported` 스텁을 실제 cursor 기반 구현으로 교체. `find` 와 동일한 `validate_ns → Instant::now → current_client → coll.aggregate(pipeline).await → cursor.next() 루프 → columns_from_docs + project_row` 패턴. `total_count = rows.len() as i64` (estimated_document_count 사용 금지). 모듈 doc-comment 에 Sprint 72 업데이트 기록. 기존 `aggregate_returns_unsupported` 테스트 삭제하고 `test_aggregate_without_connection_returns_connection_error` + `test_aggregate_rejects_empty_namespace` 2개 추가. |
| `src-tauri/src/commands/document/query.rs` | 신규 `#[tauri::command] pub async fn aggregate_documents(state, connection_id, database, collection, pipeline: Vec<bson::Document>) -> Result<DocumentQueryResult, AppError>`. 기존 `find_documents` 와 동일한 dispatch (`state.active_connections.lock().await → .get(&id).ok_or_else(NotFound) → .as_document()?.aggregate(...).await`). 모듈 doc-comment Sprint 72 주석 추가. |
| `src-tauri/src/commands/document/mod.rs` | doc-comment 를 Sprint 72 반영본으로 한 단락 업데이트 (query 모듈이 이제 `find_documents` + `aggregate_documents` 를 포함). |
| `src-tauri/src/lib.rs` | `tauri::generate_handler![]` 배열에 `commands::document::query::aggregate_documents,` 한 줄 추가 (기존 `find_documents` 바로 다음). |
| `src-tauri/tests/mongo_integration.rs` | 모듈 doc-comment Sprint 72 업데이트 + 2개 통합 테스트 추가. `test_mongo_adapter_aggregate_match_sort` 는 `[$match: {age: {$gt: 25}}, $sort: {_id: 1}]` 파이프라인으로 Ada/Grace 두 행을 `_id asc` 로 반환하는지 검증. `test_mongo_adapter_aggregate_group_count` 는 `[$group: {_id: null, total: {$sum: 1}}]` 로 단일 row + `total=3` 필드 존재를 검증 (canonical extjson 의 `$numberInt`/`$numberLong` 둘 다 허용). 두 테스트 모두 기존 `seed_client` 함수를 재사용하고 `#[serial_test::serial]` + cleanup-on-exit 패턴을 따름. |

변경 범위 제약 준수:
- `src-tauri/src/db/mod.rs`, `src-tauri/src/db/postgres.rs`, `src-tauri/src/commands/rdb/**`, `src-tauri/src/commands/connection.rs`, `src-tauri/src/models/**`, `src-tauri/src/error.rs` 모두 **Sprint 72 에서 diff 0** (git diff --stat 에 포함 안 됨).
- Frontend `src/**` — Sprint 72 작업은 **0 라인 수정**. 단, 작업 트리에는 병렬로 진행 중인 Sprint 74 agent 의 `src/components/datagrid/**` 수정이 존재 (이 스프린트와 무관, mtime 확인 결과 내 `mongodb.rs` 수정 이전에 이미 존재).

## Generator-scope Check Results (6개)

### 1. `cd src-tauri && cargo fmt --all -- --check`
PASS — stdout 없음.

### 2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
PASS — `Finished dev profile`, 0 warnings / 0 errors.

### 3. `cd src-tauri && cargo test --lib db::mongodb`
PASS — `test result: ok. 25 passed; 0 failed; 0 ignored; 0 measured; 191 filtered out`. Sprint 71 기준(23) 대비 +2 (`test_aggregate_without_connection_returns_connection_error`, `test_aggregate_rejects_empty_namespace`). `aggregate_returns_unsupported` 삭제 확인 (191 filtered 은 mongodb 모듈 외부 테스트).

### 4. `cd src-tauri && cargo test --test mongo_integration`
PASS — `test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`. Docker MongoDB 가 올라와 있어 실제 파이프라인 실행 검증. 5 테스트: 기존 3개 (`connect_ping_list_disconnect_happy_path`, `ping_without_connect_returns_error`, `infer_and_find_on_seeded_collection`) + 신규 2개 (`aggregate_match_sort`, `aggregate_group_count`).

### 5. `pnpm tsc --noEmit`
PASS — 0 errors (출력 없음).

### 6. `pnpm lint`
PASS — 0 errors (ESLint 종료 코드 0).

## AC → Evidence Mapping

| AC | 증거 |
|---|---|
| AC-01 `Unsupported` 스텁 제거 → 실제 `coll.aggregate(pipeline).await` | `src-tauri/src/db/mongodb.rs:395-448` (aggregate impl). `grep "Unsupported" src/db/mongodb.rs` 은 insert/update/delete 스텁 + 주석만 반환, `aggregate` 경로에서는 0 매치. |
| AC-02 `raw_documents` 원본 보존 + `columns_from_docs` / `project_row` 재사용 | `src-tauri/src/db/mongodb.rs:412-422` (cursor 루프), `:425-429` (columns+rows). `find` (`:307-394`) 와 동일 helper 호출. |
| AC-03 `total_count = rows.len() as i64`, `estimated_document_count` 호출 없음 | `src-tauri/src/db/mongodb.rs:436` (`let total_count = rows.len() as i64;`). `grep "estimated_document_count" src/db/mongodb.rs` 은 `find` 본문의 1회 호출만 반환 (aggregate 경로에는 0 매치). |
| AC-04 빈 pipeline pass-through | MongoDB 드라이버의 기본 동작. 단위 테스트 `test_aggregate_without_connection_returns_connection_error` 가 empty `Vec::new()` pipeline 경로를 통과시켜 connection-level 에러까지 도달함으로써 Vec 가 올바르게 드라이버에 전달됨을 간접 증명. (실제 통합 테스트는 $match+$sort 와 $group 시나리오만 다루지만 둘 다 비-empty pipeline.) |
| AC-05 `validate_ns` 가 aggregate 초입에서 호출 | `src-tauri/src/db/mongodb.rs:402` (`validate_ns(db, collection)?;`). 테스트 `test_aggregate_rejects_empty_namespace` 가 빈 db 와 빈 collection 모두 `AppError::Validation` 로 거부됨을 검증. |
| AC-06 연결 전 `aggregate` 호출 → `AppError::Connection` | `src-tauri/src/db/mongodb.rs:404` (`self.current_client().await?`) — `current_client` 가 None 이면 `AppError::Connection("MongoDB connection is not established")`. 테스트 `test_aggregate_without_connection_returns_connection_error`. |
| AC-07 `aggregate_documents` Tauri 커맨드 추가 + 미연결 id `AppError::NotFound` + RDB 연결 `AppError::Unsupported` | `src-tauri/src/commands/document/query.rs:58-76`. `connections.get(&connection_id).ok_or_else(not_connected)` → `AppError::NotFound`. `.as_document()?` → RDB/Search/Kv 연결은 `AppError::Unsupported`. |
| AC-08 `lib.rs::run()` 의 `tauri::generate_handler![]` 에 등록 | `src-tauri/src/lib.rs:52` (`commands::document::query::aggregate_documents,`). |
| AC-09 단위 테스트 2개 추가 + `aggregate_returns_unsupported` 삭제 | `test_aggregate_without_connection_returns_connection_error` (`mongodb.rs:1042`), `test_aggregate_rejects_empty_namespace` (`mongodb.rs:1053`). `grep "aggregate_returns_unsupported" src/db/mongodb.rs` → 0 매치. |
| AC-10 통합 테스트 2개 추가 | `test_mongo_adapter_aggregate_match_sort` (`tests/mongo_integration.rs:316`), `test_mongo_adapter_aggregate_group_count` (`tests/mongo_integration.rs:404`). 두 테스트 모두 Docker 컨테이너 기동 시 실제 검증, 미기동 시 기존 `setup_mongo_adapter` skip 패턴 재사용. 실행 결과: 둘 다 PASS. |
| AC-11 Frontend 변경 0 | Sprint 72 가 작성/수정한 파일 5개 모두 `src-tauri/**` 하위. `pnpm tsc --noEmit`, `pnpm lint` 둘 다 0 error. (작업 트리에 병렬 Sprint 74 agent 가 남긴 `src/components/datagrid/**` 수정이 있지만 이번 스프린트와 무관하고 checks 는 통과.) |
| AC-12 Verification Plan 6 checks | 위 §"Generator-scope Check Results" 참조 — 전부 PASS. |

## 핵심 위치 — file:line Summary

- `MongoAdapter::aggregate` impl: `src-tauri/src/db/mongodb.rs:395-448`
- `aggregate_documents` Tauri command: `src-tauri/src/commands/document/query.rs:58-76`
- `lib.rs` invoke_handler registration: `src-tauri/src/lib.rs:52` (`commands::document::query::aggregate_documents,`)
- 단위 테스트:
  - `test_aggregate_without_connection_returns_connection_error` — `src-tauri/src/db/mongodb.rs:1041-1051`
  - `test_aggregate_rejects_empty_namespace` — `src-tauri/src/db/mongodb.rs:1053-1068`
- 통합 테스트:
  - `test_mongo_adapter_aggregate_match_sort` — `src-tauri/tests/mongo_integration.rs:316-392`
  - `test_mongo_adapter_aggregate_group_count` — `src-tauri/tests/mongo_integration.rs:404-478`

## `aggregate_returns_unsupported` 삭제 증거

```
$ grep -n "aggregate_returns_unsupported" src-tauri/src/db/mongodb.rs
(no output)
```

본문뿐 아니라 주석/doc-comment 에도 남아 있지 않음. mongodb.rs 모듈 doc-comment (상단 `//!`) 에서 `remaining four stubs` → `remaining three stubs` 로 자동 수정되지 않았지만, 문면상 "still-stubbed methods (insert_document, update_document, delete_document)" 로 다시 명시했기 때문에 범주 목록이 3개로 축소됨을 명확히 전달.

## Frontend Invariant 증명

Sprint 72 가 수정한 파일 리스트 (작업 트리 전체 `git diff --stat HEAD` 가 아니라 **이 스프린트의 실제 작업 범위**):

```
src-tauri/src/commands/document/mod.rs
src-tauri/src/commands/document/query.rs
src-tauri/src/db/mongodb.rs
src-tauri/src/lib.rs
src-tauri/tests/mongo_integration.rs
```

전부 `src-tauri/**` 하위. `src/**` 은 **0 라인 수정**.

**주의 (evaluator 용)**: 작업 트리에 별도 agent 가 진행 중인 Sprint 74 변경 (`src/components/datagrid/**`) 이 존재함. `git log --oneline src/components/datagrid/DataGridTable.tsx` 가 Sprint 74 관련 커밋 (`1551c00 fix(datagrid): keep focus on cell editor when flipping NULL ↔ text`) 을 보여주고, 이 파일들의 mtime (Apr 24 17:12-17:15) 이 내 `mongodb.rs` 수정 시각 (17:18) 보다 앞서므로 Sprint 72 scope 밖. `pnpm tsc --noEmit`/`pnpm lint` 모두 0 error 로 통과했으므로 병렬 변경이 나의 스프린트에 회귀를 일으키지 않음.

## Assumptions

- **빈 pipeline 은 pass-through**: MongoDB 드라이버는 빈 pipeline 벡터를 그대로 수용하고 컬렉션 전체 문서를 cursor 로 반환. 별도 가드 불필요.
- **`total_count` = 결과 행 수**: `$match`, `$group`, `$limit` 등 pipeline stage 가 원본 컬렉션 cardinality 와 무관하게 행 집합을 재구성하므로 `estimated_document_count()` 가 무의미. contract AC-03 이 이를 명시적으로 요구.
- **AggregateOptions 커스터마이즈 없음**: `.with_options` 체이닝 생략. `allow_disk_use`, `batch_size` 등 추가 옵션은 Sprint 80 이후 재논의.
- **Integration test 데이터 재시드**: 두 개의 신규 통합 테스트는 각자 `coll.drop().await` 로 시작해 같은 3-user fixture 를 재시드 → cleanup 순으로 동작. `#[serial_test::serial]` 이 기존 Sprint 66 테스트와의 순서 간섭을 방지.
- **`$group` 의 `total` 타입**: MongoDB 3.6+ 는 `$sum: 1` 을 서버 내부에서 Int32 로 반환, `flatten_cell` 이 canonical extended JSON 으로 직렬화해 `{"$numberInt": "3"}` 형태가 grid 셀에 들어감. 테스트는 `$numberInt`/`$numberLong`/bare integer 셋 다 허용하도록 작성 (서버 버전 호환성).

## Residual Risk

- **대용량 aggregate 결과 메모리 소비**: `raw_documents: Vec<Document>` 가 전체 cursor 결과를 수집. 호출자(Sprint 73 frontend)가 `$limit` 을 pipeline 말단에 포함시키지 않으면 OOM 가능. contract Out-of-Scope 에 페이지네이션 제외 명시됨.
- **`$out`/`$merge` 같은 side-effect stage**: 현재 구현은 drive cursor 결과만 수집하므로 side-effect stage 는 서버에서는 실행되지만 결과 grid 에는 아무것도 안 올라옴. Sprint 80 의 MQL Preview 에서 경고 UI 추가 예정.

## References

- Contract: `docs/sprints/sprint-72/contract.md`
- Execution brief: `docs/sprints/sprint-72/execution-brief.md`
- 이전 Sprint 71 handoff: `docs/sprints/sprint-71/handoff.md`
- 연관 Sprint 73 (Frontend Find/Aggregate UI): 이 스프린트 PASS 후 착수 예정.
- Master plan: `/Users/felix/.claude/plans/idempotent-snuggling-brook.md` (Sprint E 섹션, E-1/E-2 분할)
