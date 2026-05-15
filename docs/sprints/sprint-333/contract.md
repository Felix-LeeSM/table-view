# Sprint 333 Contract — Slice K live wire (Mongo collMod validator)

날짜: 2026-05-15

## Scope

Sprint 327 의 ValidatorPanel placeholder 를 Mongo paradigm 에서 라이브
화한다. backend `get_collection_validator` + `set_collection_validator`
trait fn + Tauri command + frontend wrapper + JSON 에디터 + Save/Clear.

`$jsonSchema` 외 모든 validator 표현식 (예: `$expr`, `$and`, 임의
operator) 도 통과한다 — 백엔드는 단순 `bson::Document` passthrough,
서버 검증에 위임.

## Done Criteria

1. **Backend**:
   - `DocumentAdapter::get_collection_validator(db, coll) -> Option<JsonValue>` 추가.
   - `DocumentAdapter::set_collection_validator(db, coll, validator: Option<JsonValue>) -> ()` 추가.
   - `MongoAdapter` impl:
     - get: `listCollections` cursor 의 options.validator 추출.
     - set: `db.runCommand({collMod, validator, validationLevel,
       validationAction})`. `validator == None` 이면 `{}` 으로 reset
       (Mongo 공식 reset 방법).
   - Tauri commands `get_mongo_validator`, `set_mongo_validator` 등록.
   - testing stubs (`StubDocumentAdapter`, `DummyDocument`,
     `FakeCancellableDocument`) trait fn impl 추가.
   - `cargo clippy --all-targets --all-features -- -D warnings` exit 0.
2. **Frontend**:
   - `@/lib/tauri/document.ts` 에 `getMongoValidator` / `setMongoValidator`
     wrapper.
   - `ValidatorPanel` 의 paradigm-mongo 분기 가 실 fetch + JSON 에디터
     + Save / Clear 버튼 + loading/error/empty 상태.
   - paradigm 이 mongo 가 아닌 곳 (RDB 라우트) 에서 mount 되는 컨텍스트는
     본 sprint scope 외 — 컴포넌트는 항상 Mongo 가정.
3. **테스트**:
   - frontend ≥ 5 신규 RTL: fetch + 비어있는 validator + edit + save 호출
     + clear 호출 + error 표면.
   - tsc / lint / vitest sweep exit 0; sprint-332 3776 → +5.

## Out of Scope

- `$jsonSchema` 의 GUI 빌더 (현재는 raw JSON textarea).
- validationLevel / validationAction 토글 (default = "moderate" / "error").
- RDB CHECK constraint 통합 view (별 sprint).

## Verification Plan

- Profile: `mixed` (Rust clippy + JS vitest).
- Required checks:
  1. `cargo clippy --all-targets --all-features -- -D warnings` exit 0.
  2. `cargo test --lib mongodb::schema` 통과.
  3. `pnpm vitest run --no-coverage` — sprint-332 3776 → +5.
  4. `pnpm tsc --noEmit` exit 0.
  5. `pnpm lint` exit 0.
