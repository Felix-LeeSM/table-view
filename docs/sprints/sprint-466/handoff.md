# Sprint 466 Handoff

## Scope

Sprint 466 adds the first runtime-backed Redis/Valkey KV slice:

- Redis adapter lifecycle: connect, ping, disconnect, URL construction, auth, database index selection, and `rediss://` when TLS is enabled.
- KV catalog: list databases, report current database, switch database, and bounded key scan through Redis `SCAN`.
- Key metadata: Redis key type, TTL state, type-specific length, and memory usage when Redis supports `MEMORY USAGE`.
- Renderer wiring: Redis is a supported connection type, URL import accepts `redis://` and `rediss://`, and the workspace mounts a Redis key-browser sidebar.

## Invariants

- Sprint 467 value preview, string editing, delete, TTL mutation, and stream read remain out of scope.
- Future KV trait methods still use the Sprint 465 default `Unsupported` behavior unless this sprint explicitly implements catalog/key-browser behavior.
- Key browsing uses bounded SCAN requests (`limit` defaults to 100 and clamps to 500) and does not call `KEYS`.
- Frontend IPC wrappers expose only catalog/key-browser commands for this slice.

## Validation

Required before PR handoff:

- `pnpm exec tsc -b --pretty false`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `git diff --check`

Focused checks:

- Redis adapter pure contract tests.
- KV command dispatch tests.
- Redis connection URL/data-source tests.
- `KvSidebar` and `WorkspaceSidebar` tests.
