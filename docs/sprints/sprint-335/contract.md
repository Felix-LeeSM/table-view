# Sprint 335 Contract — Slice M live wire (RDB/Mongo CREATE/DROP DATABASE)

날짜: 2026-05-15

## Scope

Sprint 327 의 DbLifecycleDialog placeholder 를 live 화한다. RDB 는
`CREATE DATABASE` / `DROP DATABASE` 양쪽 모두, Mongo 는 `dropDatabase`
만 (Mongo create 는 lazy — collection 첫 write 시 자동 생성, 안내
copy 로 처리).

## Done Criteria

1. **Backend**:
   - `RdbAdapter::create_database(name) -> ()` — default `Unsupported`.
     PG override: pool.acquire() 한 connection 에서
     `CREATE DATABASE "<quoted>"` 실행.
   - `RdbAdapter::drop_database(name) -> ()` — default `Unsupported`.
     PG override: `DROP DATABASE "<quoted>"`.
   - `DocumentAdapter::drop_database(name) -> ()` — Mongo:
     `client.database(name).drop()`.
   - Tauri commands `create_rdb_database`, `drop_rdb_database`,
     `drop_mongo_database` 등록.
   - testing stubs.
   - `cargo clippy ... -D warnings` exit 0.
2. **Frontend**:
   - `@/lib/tauri/document.ts` 에 `dropMongoDatabase` wrapper.
   - 신규 `@/lib/tauri/ddl.ts` 또는 기존 schema.ts 에 `createRdbDatabase`
     / `dropRdbDatabase` wrapper.
   - DbLifecycleDialog 4 case:
     - paradigm=table, mode=create → name input + dispatch
       `createRdbDatabase`.
     - paradigm=table, mode=drop → confirm + dispatch `dropRdbDatabase`.
     - paradigm=document, mode=create → informational copy ("Mongo
       creates databases on first write"). Save = no-op + close.
     - paradigm=document, mode=drop → confirm + dispatch
       `dropMongoDatabase`.
3. **테스트**:
   - frontend ≥ 4 신규 RTL: RDB create dispatch / RDB drop dispatch /
     Mongo lazy create info / Mongo drop dispatch.
   - tsc / lint / vitest sweep exit 0.

## Out of Scope

- RDB CREATE DATABASE WITH OWNER / TEMPLATE / ENCODING 옵션.
- RDB DROP DATABASE WITH (FORCE).
- MySQL/SQLite override (Phase 17 별 sprint).

## Verification Plan

- Profile: `mixed`.
- Required checks:
  1. `cargo clippy --all-targets --all-features -- -D warnings` exit 0.
  2. `cargo test --lib` 통과.
  3. `pnpm vitest run --no-coverage` — sprint-334 3784 → +2..+4.
  4. `pnpm tsc --noEmit` exit 0.
  5. `pnpm lint` exit 0.
