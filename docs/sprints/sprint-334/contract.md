# Sprint 334 Contract — Slice L live wire (Mongo create/renameCollection)

날짜: 2026-05-15

## Scope

Sprint 327 의 CollectionDdlDialog placeholder 를 live 화한다. backend
`create_collection` + `rename_collection` trait fn + Tauri command +
frontend wrapper + dialog 의 create/rename/drop 3 모드 UX. drop 은 이미
존재하는 `dropCollection` wrapper 에 후킹.

## Done Criteria

1. **Backend**:
   - `DocumentAdapter::create_collection(db, collection, options: Option<JsonValue>) -> ()`.
   - `DocumentAdapter::rename_collection(db, from, to) -> ()`.
   - `MongoAdapter` impl:
     - create: `db.runCommand({create: <coll>, ...options})` (options pass-thru).
     - rename: `client.database("admin").runCommand({renameCollection: "<db>.<from>", to: "<db>.<to>"})`.
   - Tauri commands `create_collection`, `rename_collection`.
   - testing stubs.
   - `cargo clippy ... -D warnings` exit 0.
2. **Frontend**:
   - `@/lib/tauri/document.ts`: `createCollection` + `renameCollection`.
   - `CollectionDdlDialog`:
     - "create" mode: name input + optional raw-JSON options textarea +
       Save.
     - "rename" mode: from label + to input + Save.
     - "drop" mode: confirmation copy + Save calls `dropCollection`.
   - Save 후 dialog close + onClose 호출.
3. **테스트**:
   - frontend ≥ 4 신규 RTL: create dispatch / rename dispatch / drop
     dispatch / invalid JSON in create options 가드.
   - tsc / lint / vitest sweep exit 0.

## Out of Scope

- timeseries / capped 의 dedicated form 필드 (v0 는 raw JSON options
  textarea 만).
- 다른 DB 로의 renameCollection (`dropTarget: true` 등).
- collection 의 storage stats / index summary 통합 — Sprint 338 (U3).

## Verification Plan

- Profile: `mixed`.
- Required checks:
  1. `cargo clippy --all-targets --all-features -- -D warnings` exit 0.
  2. `cargo test --lib mongodb::schema` 통과.
  3. `pnpm vitest run --no-coverage` — sprint-333 3781 → +4.
  4. `pnpm tsc --noEmit` exit 0.
  5. `pnpm lint` exit 0.
