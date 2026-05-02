# Sprint 197 — Findings

Sprint: `sprint-197` (refactor — `db/mongodb.rs` 4-way split).
Date: 2026-05-02.
Status: closed.

## 0. Entry pattern — `mongodb.rs` 유지 (modern 2018+) vs `mod.rs`

### 발견

분할 직후 1차 시도는 `mongodb/mod.rs` 패턴이었다 (2015 레거시). 사용자
피드백 — `mongodb.rs` 가 사라지면 git blame / `git log --follow` 가
끊겨 history 추적이 불편하고, 같은 디렉토리의 `db/postgres.rs` 와
codebase 일관성도 깨짐. modern Rust 2018+ 권장 스타일은 `mongodb.rs` 를
entry 로 유지하면서 `mongodb/<sub>.rs` 하위 파일을 두는 것.

### 결정

`mongodb.rs` 를 entry 로 유지 (1809 → 198 줄 modification, 동일 path).
`mongodb/{connection, schema, queries, mutations}.rs` 4 신규.

```
db/
  mongodb.rs              # entry: pub use connection::MongoAdapter
                          #         + mod 선언 + impl DocumentAdapter
  mongodb/
    connection.rs
    schema.rs
    queries.rs
    mutations.rs
  postgres.rs             # 기존 — 같은 entry style
```

git diff 상 `mongodb.rs` 1727 줄 modification (-1669 / +58) +
`mongodb/<x>.rs` × 4 신규. `git log --follow src-tauri/src/db/mongodb.rs`
가 pre-split 시점까지 끊김 없이 이어진다.

### 트레이드오프

- `mongodb.rs` 의 198 줄에 대한 git blame 은 본 sprint commit 이 origin
  으로 보임 (대량 삭제 + 신규 추가의 형태). pre-split 1809 줄의 blame
  은 git follow 로만 추적. modern 패턴이 더 깔끔하지만 blame surface
  자체는 mod.rs 패턴과 동등.
- `db/postgres.rs` (3684줄) 가 향후 분할될 때도 같은 entry-pattern 을
  적용하면 일관성 유지.

## 1. Trait impl block 단일화 제약 → inherent `_impl` 패턴

### 발견

Rust 는 `impl Trait for Type { ... }` 블록을 여러 파일에 split 할 수
없다 (orphan rule + coherence). 반면 inherent `impl Type { ... }` 은
다중 블록을 허용한다. 1809-line monolith 의 본체는 사실상 `impl
DocumentAdapter for MongoAdapter` 안의 9 method body 였기 때문에 단순
파일 분할은 불가능.

### 결정

각 토픽 파일에서:

```rust
impl MongoAdapter {
    pub(super) async fn list_databases_impl(&self) -> Result<...> {
        // body verbatim from pre-split file
    }
}
```

`mongodb.rs` (entry) 에서:

```rust
impl DocumentAdapter for MongoAdapter {
    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<...>> {
        Box::pin(async move { self.list_databases_impl().await })
    }
    // ...8 more, 동일 패턴
}
```

trait dispatch 는 `mongodb.rs` 에 1 곳만, 각 method body 는 토픽 파일의
inherent 에 위치. 행동 변경 0.

### 트레이드오프

- **추가 indirection 1 hop** — trait method 호출 → `_impl` 호출. 핫
  패스 (`find` / `insert_document`) 에 한 번 더 await 가 끼지만
  zero-cost (Rust 의 async은 state machine, 실제 await 없음).
- **`pub(super)` 가시성 누수 0** — inherent `_impl` 메서드는 `pub(super)`
  으로 mod 내부에서만 호출되므로 외부 crate 에서 보이지 않는다.
  외부 호출자는 trait method 만 사용.
- **cancel-token 처리 위치** — `tokio::select!` 은 `mongodb.rs` 의
  trait dispatch 측으로 옮겼다. `_impl` 자체는 cancel 비인지 단순 async.
  pre-split 에서는 각 method body 안에 cancel-token 분기가 inline 으로
  녹아있었고 그 부분만 trait 측으로 lift. body 의 driver 호출 sequence
  자체는 verbatim.

## 2. 헬퍼 분포 — `bson_type_name` cross-module 1 곳

### 발견

`schema::infer_columns_from_samples` 가 `queries::bson_type_name` 를
호출. 즉 schema 토픽이 queries 토픽의 헬퍼를 cross-import 하는 그래프.
단순화 위해 이 헬퍼를 schema 로 옮기는 안과 그대로 두는 안을 비교.

### 결정

queries.rs 에 둔 채 `pub(super) use super::queries::bson_type_name` 으로
cross-import. 이유:

- `bson_type_name` 은 cell-level BSON 타입 매핑 — `flatten_cell` 과 1:1
  대응이라 queries 의 cell-flatten 헬퍼군과 인접해야 자연스러움.
- schema 측은 1 곳만 호출 (`infer_columns_from_samples` 안 1 줄).
  이동 비용보다 cross-import 1 줄이 가벼움.

미래 Sprint 에서 `bson_type_name` 을 추가로 호출하는 사이트가 늘어나면
공용 모듈로 격상 검토.

## 3. 테스트 분산 — 30+ → 4 파일

### 발견

pre-split mongodb.rs 는 file-bottom 에 단일 `mod tests` 안에 30+ test
case 를 갖고 있었다. test 카테고리는 connection lifecycle / build_options /
helper 검증 / `*_without_connection` smoke / `*_rejects_empty` validation
/ `document_id` round-trip 등으로 주제별 그룹핑이 이미 주석으로 되어
있었음.

### 결정

각 토픽 파일에 자기 주제 테스트만 모음:

- `connection.rs::tests` — 12 case (new / default / build_options × 2 /
  ping / disconnect / switch_active_db × 3 / resolved_db_name × 4 + 1
  ignored live-mongo)
- `schema.rs::tests` — 8 case (list_databases / list_collections /
  infer_collection_fields × 3 / infer_columns_from_samples × 3)
- `queries.rs::tests` — 8 case (find × 2 / aggregate × 2 / flatten_cell ×
  2 / project_row × 1 / find_body_default × 1)
- `mutations.rs::tests` — 12 case (insert × 2 / update × 3 / delete × 2 /
  document_id_to_bson × 4 / bson_id_to_document_id × 2)

총 합 40+1 ignored (pre-split count 와 동일).

### 트레이드오프

분산은 가독성 win 이지만 cross-file 일관성 (예: 같은 `match` arm 패턴
반복) 은 사람이 직접 점검해야 함. lint 자동 보장 안 됨.

## 4. cargo fmt 후속 — 1 multi-line `?` 호출 collapse

### 발견

수동 코딩 시 의도적으로 multi-line 작성한
`return Err(AppError::Database(format!("cursor iteration failed: {e}")));`
1 줄 (queries.rs / schema.rs 에 동일 패턴) 을 `cargo fmt` 가 single-line
으로 collapse. 본 sprint 의 fmt 차이 = 코드 의미는 동일.

### 결정

`cargo fmt` 결과를 그대로 채택 (lint 와 fmt 모두 force). 회피는 없음.

## 5. 검증 결과

- `cargo fmt -- --check` — 0 차이.
- `cargo clippy --all-targets --all-features -- -D warnings` — 0 warnings.
- `cargo test --lib mongodb` — 45 passed / 1 ignored (`test_switch_active_db_happy_path_with_live_mongo` — 라이브 Mongo 필요, pre-split 동일 정책).
- `cargo test --lib` — 338 passed / 2 ignored (pre-split baseline 동일).
- frontend: 변경 없음. `pnpm tsc --noEmit` 0 errors.
- 라인 수: pre-split 1809 → post-split 1908 (mongodb.rs 198 +
  connection 609 + schema 346 + queries 398 + mutations 357). 증가
  99 라인은 file frontmatter doc + trait dispatch shim 합. 각 파일
  < 700.

## 6. Sprint 198 진입 영향

`mutations.rs` 는 inherent `impl MongoAdapter { ... }` 블록 + 헬퍼 ×
3 만 가짐 (357 라인). Sprint 198 의 3 신규 command (`delete_many` /
`update_many` / `drop_collection`) 는:

1. `mutations.rs` 의 inherent block 안에 `delete_many_impl` /
   `update_many_impl` / `drop_collection_impl` 3 method 추가.
2. `mongodb.rs` 의 `impl DocumentAdapter for MongoAdapter` 에 3 line
   dispatch 추가 (필요 시 trait 자체 확장).

다른 파일 (connection / schema / queries) 미수정. 토픽 격리 달성.
