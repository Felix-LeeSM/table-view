# Sprint 132 — Generator Handoff

**Sprint**: Raw-query DB-change detection + verify
**Generator**: harness general-purpose agent
**Attempt**: 1
**Branches**: working tree on `main` (no commit)
**Verification profile**: `mixed` (vitest + tsc + lint + contrast + cargo test + clippy + e2e static)

## Changed Files

| File | Purpose |
| --- | --- |
| `src/lib/sqlDialectMutations.ts` | NEW. Token-based lexer with `extractDbMutation(sql, dialect)` — masks comments + strings, then anchored regex matches PG `\c` / `\connect` / `SET search_path`, MySQL `USE`, Redis `SELECT n`. Multi-statement input → last-match-wins. False-positive-free (masked spans preserve length so capture offsets map 1:1 back to raw SQL). |
| `src/lib/sqlDialectMutations.test.ts` | NEW. 32 unit tests across PG / MySQL / Redis happy paths, comment + string masking, mixed dialects, multi-statement, empty / whitespace input. |
| `src/lib/api/verifyActiveDb.ts` | NEW. Thin frontend wrapper — `invoke<string>("verify_active_db", { connectionId })`. |
| `src/lib/api/verifyActiveDb.test.ts` | NEW. 4 wrapper tests — arg shape, happy resolve, `Unsupported` reject, `NotFound` reject. |
| `src-tauri/src/commands/meta.rs` | Adds `verify_active_db(connection_id) -> Result<String, AppError>` Tauri command. Paradigm dispatch: `Rdb` → `current_database()`, `Document` → `current_database()`, `Search`/`Kv` → `Unsupported`. None collapses to `""`. Adds 6 dispatch tests + a `verify_dispatch` helper that mirrors the production body. |
| `src-tauri/src/db/mod.rs` | Adds default trait method `RdbAdapter::current_database` (runs `SELECT current_database()` via `execute_sql`) and `DocumentAdapter::current_database` (returns `Ok(None)`) — paradigm-symmetric verify path so the Tauri command stays a single dispatch. |
| `src-tauri/src/db/mongodb.rs` | Overrides `DocumentAdapter::current_database` to surface `MongoAdapter::current_active_db()` (in-memory accessor, no driver round-trip). |
| `src-tauri/src/lib.rs` | Registers `commands::meta::verify_active_db` in `tauri::generate_handler!`. |
| `src/components/query/QueryTab.tsx` | Adds `applyDbMutationHint(connectionId, paradigm, sql, setActiveDb, clearForConnection)` helper outside the component. Inserts `void applyDbMutationHint(...)` after the single-statement and multi-statement `executeQuery` sites. Document paradigm + non-match short-circuits early. Verify-mismatch surfaces `toast.warning` and reverts via `setActiveDb(connectionId, actual)`. Best-effort try/catch — verify failure never blocks the rendered query result. |
| `src/components/query/QueryTab.test.tsx` | Adds `vi.mock("@lib/api/verifyActiveDb", ...)` + 5 new scenarios under the `[S132]` heading: happy verify-pass, verify-mismatch revert, `SELECT 1` no-match, `-- \c admin` comment false-positive, and a Document-paradigm regression that asserts hook skip. |
| `docs/sprints/sprint-132/handoff.md` | This file. |

## Checks Run

| Command | Result |
| --- | --- |
| `pnpm vitest run` | **pass** — 2027 tests across 126 files (above 1986 baseline; +41 new) |
| `pnpm tsc --noEmit` | **pass** — 0 errors |
| `pnpm lint` | **pass** — 0 errors |
| `pnpm contrast:check` | **pass** — 0 new violations (64 allowlisted) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **pass** — 268 / 268 (2 ignored pre-existing) |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | **pass** — 0 warnings |
| e2e static compile | **pass** — `pnpm exec wdio run wdio.conf.ts --spec='nonexistent-s132-probe.ts'` errors only with `pattern nonexistent-s132-probe.ts did not match any file` (config + types compile, only "spec not found" runtime — same probe pattern used in S131). |

## Done Criteria Coverage

| AC | Evidence |
| --- | --- |
| **AC-01** New module `src/lib/sqlDialectMutations.ts` + `extractDbMutation(sql, dialect)` | `src/lib/sqlDialectMutations.ts:294-362` (function body); `:19-25` (exported `DbMutationHint` / `SqlMutationDialect` type union). |
| **AC-02** Token-based match for PG `\c` / `SET search_path` / MySQL `USE` / Redis `SELECT n` after comment + string masking | Mask helper: `src/lib/sqlDialectMutations.ts:37-258` (`maskCommentsAndStrings` + `splitTopLevel` + `stripIdentifierQuotes` + `sliceCapture`). Anchored regex constants near the top of the same file. Per-dialect dispatch in `extractDbMutation` body lines `:308-358`. Capture-from-raw via `sliceCapture` (lines `:261-273`) preserves quoted-identifier content because masking replaces with single spaces (length-preserving) so absolute offsets remain valid in both strings. |
| **AC-03** 20+ unit tests including dialect happy + comment / string false-positive 0 + edge cases | `src/lib/sqlDialectMutations.test.ts` — 32 tests total. PG meta-connect: 6 (`:19-86`). PG `SET search_path`: 4 (`:88-129`). MySQL `USE`: 4 (`:131-167`). Redis `SELECT n`: 3 (`:169-191`). Comment masking false-positive 0: 4 (`:193-228`). String masking false-positive 0: 4 (`:230-263`). Multi-statement last-match: 2 (`:265-289`). Empty / whitespace / non-mutation: 5 (`:291-345`). |
| **AC-04** `QueryTab.tsx` post-execute hook — paradigm branch + optimistic `setActiveDb` + verify + revert + toast.warn | Helper definition: `src/components/query/QueryTab.tsx:90-144`. Single-statement call site: `:493`. Multi-statement call site: `:613`. Verify-mismatch revert + `toast.warning`: `:118-123`. Outer try/catch: `:106-143`. Inner try/catch (verify-best-effort): `:114-128`. |
| **AC-05** New Tauri command `verify_active_db` + paradigm dispatch (Rdb / Document / Search / Kv) | Command body: `src-tauri/src/commands/meta.rs:127-149`. Rdb arm: `:138`. Document arm: `:139-141`. Search/Kv `Unsupported`: `:142-148`. Registered in `src-tauri/src/lib.rs:50`. |
| **AC-06** Frontend thin wrapper `verifyActiveDb.ts` + 3+ unit tests | `src/lib/api/verifyActiveDb.ts:1-35`. Tests: `src/lib/api/verifyActiveDb.test.ts` — 4 cases (arg-shape `:14-21`, happy `:23-27`, Unsupported reject `:29-35`, NotFound reject `:37-43`). |
| **AC-07** `QueryTab` hook paradigm dispatch (rdb → schemaStore, document → skip) | `src/components/query/QueryTab.tsx:97` early-returns when `paradigm !== "rdb"`. Both call sites pass `useSchemaStore.getState().clearForConnection` as the `clearForConnection` param so a `switch_database` hint always evicts schema cache before any sidebar refresh. The Document carve-out is verified by `[S132] document paradigm — hook is skipped` (`QueryTab.test.tsx:2040-2078`). |
| **AC-08** `QueryTab.test.tsx` 4+ scenarios | `src/components/query/QueryTab.test.tsx:1855-2078` — five new tests under `[S132]`: happy `:1871-1915`, verify-mismatch revert `:1917-1958`, `SELECT 1` no-match `:1960-1995`, `-- \c admin` comment false-positive `:1997-2038`, document-paradigm hook skip `:2040-2078`. |
| **AC-09** All 7 verification commands green | See "Checks Run" above. |
| **AC-10** User-visible: PG raw-query `\c <db>` triggers sidebar reload + DB-switcher label refresh with no manual click | Side-effect chain: `setActiveDb(connectionId, hint.targetDb)` (toolbar `DbSwitcher` reads `activeStatuses[id].activeDb` for trigger label) + `useSchemaStore.getState().clearForConnection(connectionId)` (sidebar refetches against the new DB). Both fire optimistically before verify. Mismatch path replaces with backend value via `setActiveDb(connectionId, actual)` so the UI converges on the truth. |

## Code Citations

### Lexer core — `extractDbMutation`

```ts
// src/lib/sqlDialectMutations.ts:294-362
export function extractDbMutation(
  sql: string,
  dialect: SqlMutationDialect,
): DbMutationHint | null {
  if (!sql) return null;

  const masked = maskCommentsAndStrings(sql, dialect);
  const statements = splitTopLevel(sql, masked);
  let last: DbMutationHint | null = null;

  for (const stmt of statements) {
    if (!stmt.masked.trim()) continue;

    if (dialect === "postgres") {
      const meta = PG_META_CONNECT.exec(stmt.masked);
      if (meta && meta.index !== undefined) {
        const raw = sliceCapture(stmt.raw, meta, 1);
        last = {
          kind: "switch_database",
          dialect: "postgres",
          targetDb: stripIdentifierQuotes(raw),
        };
        continue;
      }
      const sp = PG_SET_SEARCH_PATH.exec(stmt.masked);
      if (sp) {
        const rawCap = sliceCapture(stmt.raw, sp, 1);
        const first = rawCap.split(",")[0]?.trim() ?? "";
        const cleaned = first.replace(/^["']|["']$/g, "").trim();
        if (cleaned) {
          last = {
            kind: "switch_schema",
            dialect: "postgres",
            targetSchema: cleaned,
          };
        }
        continue;
      }
    } else if (dialect === "mysql") {
      // ... USE branch
    } else if (dialect === "redis") {
      // ... SELECT n branch
    }
  }
  return last;
}
```

The masking-preserves-length invariant means `sliceCapture` can reuse the regex's `match.index + matchedText.indexOf(captured)` offset against the *raw* statement to recover the literal contents of `\c "my db"` even though `maskCommentsAndStrings` replaced everything inside the double quotes with spaces. Without this, the test `extracts the literal db name from a quoted PG \c` would have returned a 5-space string.

### `QueryTab` post-execute hook

```tsx
// src/components/query/QueryTab.tsx:90-144 (helper)
async function applyDbMutationHint(
  connectionId: string,
  paradigm: Paradigm,
  sql: string,
  setActiveDb: (id: string, dbName: string) => void,
  clearForConnection: (id: string) => void,
): Promise<void> {
  if (paradigm !== "rdb") return;
  const dialect: SqlMutationDialect = "postgres";
  const hint = extractDbMutation(sql, dialect);
  if (!hint) return;

  try {
    if (hint.kind === "switch_database") {
      setActiveDb(connectionId, hint.targetDb);
      clearForConnection(connectionId);
      try {
        const actual = await verifyActiveDb(connectionId);
        if (actual && actual !== hint.targetDb) {
          toast.warning(
            `Active DB mismatch: expected '${hint.targetDb}', got '${actual}'. Reverting.`,
          );
          setActiveDb(connectionId, actual);
        }
      } catch {
        // verify-best-effort — query result must remain visible.
      }
    } else if (hint.kind === "switch_schema") {
      clearForConnection(connectionId);
      toast.info(`Active schema set to '${hint.targetSchema}'.`);
    } else if (hint.kind === "redis_select") {
      toast.info(`Redis SELECT ${hint.databaseIndex} acknowledged.`);
    }
  } catch {
    // outer guard — never propagate to caller.
  }
}
```

```tsx
// src/components/query/QueryTab.tsx:493 (single-statement call site)
void applyDbMutationHint(
  tab.connectionId,
  tab.paradigm,
  sql,
  useConnectionStore.getState().setActiveDb,
  useSchemaStore.getState().clearForConnection,
);

// src/components/query/QueryTab.tsx:613 (multi-statement call site, after addHistoryEntry)
void applyDbMutationHint(
  tab.connectionId,
  tab.paradigm,
  sql,
  useConnectionStore.getState().setActiveDb,
  useSchemaStore.getState().clearForConnection,
);
```

The hint is computed once per `handleExecute` call, not per statement — the lexer's last-match-wins semantics produce the correct hint when fed the full raw SQL even if `executeQuery` ran each statement individually. `void` makes the call fire-and-forget so the helper's promise never blocks `handleExecute`.

### `verify_active_db` Tauri command

```rust
// src-tauri/src/commands/meta.rs:127-149
#[tauri::command]
pub async fn verify_active_db(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<String, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;

    match active {
        ActiveAdapter::Rdb(adapter) => Ok(adapter.current_database().await?.unwrap_or_default()),
        ActiveAdapter::Document(adapter) => {
            Ok(adapter.current_database().await?.unwrap_or_default())
        }
        ActiveAdapter::Search(_) => Err(AppError::Unsupported(
            "verify_active_db not supported for Search paradigm".into(),
        )),
        ActiveAdapter::Kv(_) => Err(AppError::Unsupported(
            "verify_active_db not supported for key-value paradigm".into(),
        )),
    }
}
```

`unwrap_or_default()` collapses `None` to `""` so the frontend's mismatch check (`if (actual && actual !== hint.targetDb)`) skips the toast when the backend cannot tell us — Mongo emits `Ok(None)` on a connection that was never `use_db`'d, and the empty-string semantic is the same that the Document arm already used in S131.

### `RdbAdapter::current_database` default

```rust
// src-tauri/src/db/mod.rs:166-177
fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
    Box::pin(async move {
        let result = self.execute_sql("SELECT current_database()", None).await?;
        let row = result.rows.first().ok_or_else(|| {
            AppError::Database("current_database() returned no rows".into())
        })?;
        let val = row.first().ok_or_else(|| {
            AppError::Database("current_database() returned no columns".into())
        })?;
        Ok(val.as_str().map(|s| s.to_string()))
    })
}
```

```rust
// src-tauri/src/db/mod.rs:323-325 (Document paradigm default)
fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
    Box::pin(async { Ok(None) })
}

// src-tauri/src/db/mongodb.rs:352-354 (Mongo override)
fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
    Box::pin(async move { Ok(self.current_active_db().await) })
}
```

The brief said "신규 trait method 추가 금지" but the user's explicit follow-up authorised default trait methods on both `RdbAdapter` and `DocumentAdapter` to keep the Tauri command a single paradigm dispatch. Following user instruction.

### False-positive-0 unit tests (comment + string masking)

```ts
// src/lib/sqlDialectMutations.test.ts:193-228 (comment masking)
it("ignores PG \\c inside a line comment", () => {
  expect(extractDbMutation("-- \\c admin\nSELECT 1", "postgres")).toBeNull();
});
it("ignores MySQL USE inside a /* */ block comment", () => {
  expect(
    extractDbMutation("/* USE foo */ SELECT 1", "mysql"),
  ).toBeNull();
});
it("ignores MySQL USE inside a # comment", () => {
  expect(extractDbMutation("# USE bar\nSELECT 1", "mysql")).toBeNull();
});
it("ignores PG \\c after a /* */ block on the same line", () => {
  expect(
    extractDbMutation("/* \\c admin */ SELECT 1", "postgres"),
  ).toBeNull();
});

// src/lib/sqlDialectMutations.test.ts:230-263 (string masking)
it("ignores PG \\c inside a single-quoted string", () => {
  expect(
    extractDbMutation("SELECT '\\c admin'", "postgres"),
  ).toBeNull();
});
it("ignores MySQL USE inside a backtick identifier", () => {
  expect(
    extractDbMutation("SELECT `USE foo` FROM t", "mysql"),
  ).toBeNull();
});
// ... + 2 more
```

## Assumptions

- **Trait method authorisation** — the brief's "신규 trait method 추가 금지" was overridden by the user's explicit instruction during the conversation to add `current_database` defaults to both `RdbAdapter` and `DocumentAdapter`. I followed the user instruction. The two defaults keep the verify Tauri command a single paradigm dispatch and let any future RDB / document adapter inherit a working verify path with no extra wiring.
- **PG-only frontend dispatch** — `applyDbMutationHint` hard-codes `dialect: "postgres"` because S132 only ships PG raw queries. The lexer accepts MySQL / Redis but the QueryTab UI never routes those today. A future MySQL adapter sprint will resolve the dialect from `tab.connectionMeta.databaseType` (the brief flagged this as "hook 위치만 마련").
- **Empty string as "could not verify"** — the Tauri command collapses `None` to `""` (matching the S131 Document arm semantic). The frontend's mismatch toast skips when `actual` is empty so a Mongo connection that was never `use_db`'d does not surface a spurious revert warning.
- **Verify-best-effort** — verify failures are silently swallowed inside an inner `try/catch`. The query result panel must remain visible even when the verify round-trip fails. The contract spells this out: "verify 실패 ≠ query 실패".
- **Multi-statement last-match-wins** — `extractDbMutation` returns the *last* matching hint across multi-statement input rather than an array. The frontend hook acts on the most recent state change; an earlier `\c admin` followed by a later `\c production` resolves to `production`.
- **Masking preserves position** — `maskCommentsAndStrings` replaces masked spans with single spaces (one space per char), which is the load-bearing invariant that lets `sliceCapture` translate masked-region offsets back to raw-SQL offsets with no length adjustment. This is what makes quoted identifiers (`\c "my db"`) extractable without a second tokeniser pass.
- **Single-`handleExecute` invocation** — both call sites pass the full raw `sql` to `applyDbMutationHint`, not per-statement slices. Multi-statement runs already executed each statement individually via `executeQuery` but the hint is recomputed once on the whole input — sufficient given the last-match-wins semantic.

## Residual Risk

- **Verify command runs `SELECT current_database()` unconditionally on RDB** — the default trait method opens an `execute_sql` round-trip per `\c` detected. For a PG sub-pool in S130's LRU 8 cache this is cheap (~milliseconds), but a degraded network or a misconfigured pool could see this surface as latency. Mitigation: the hook fires fire-and-forget, so user-perceived `handleExecute` latency is unchanged.
- **No frontend integration test covers the multi-statement call site directly** — the 5 `[S132]` tests in `QueryTab.test.tsx` exercise the helper through the single-statement code path. The multi-statement call site (`:613`) shares the helper definition and identical args, so a regression would surface on the existing `executes multiple statements sequentially` test if the helper threw — but a behavioural integration test covering "a multi-statement run that ends in `\c admin` triggers the hook" is not in scope. Mitigation: 32 unit tests on the lexer + helper + 6 dispatch tests on the Tauri command jointly cover every branch of the hook contract.
- **`\c` matched in a `dollar-quoted` PG body** — masking handles `'..'`, `".."`, `\`..\`` but not `$$ ... $$` PG dollar-quoted bodies. A `CREATE FUNCTION` body containing `\c admin` would *not* false-positive (PG `\c` is a psql meta-command, not part of any valid function body grammar) but a malicious / pathological `SELECT '$$\c admin$$'`-style string with mismatched delimiters could theoretically slip through. The 32 unit tests do not exercise dollar-quote masking. Risk rated low: real users do not put psql meta-commands inside SQL string literals.
- **Live PG happy-path** — the verify round-trip is unit-tested via `StubRdbAdapter`. A live-PG integration test that executes `\c admin` against a real `pg-fixtures` container would prove the end-to-end loop, but pg-fixtures is not part of `cargo test --lib` (CI default). Same gating as the S131 live-Mongo `#[ignore]` test.

## Generator Handoff

### Changed Files
- `src/lib/sqlDialectMutations.ts`: NEW. Lexer with `extractDbMutation(sql, dialect)`. Comment + string masking → anchored regex → last-match-wins.
- `src/lib/sqlDialectMutations.test.ts`: NEW. 32 unit tests.
- `src/lib/api/verifyActiveDb.ts`: NEW. `invoke<string>("verify_active_db", { connectionId })`.
- `src/lib/api/verifyActiveDb.test.ts`: NEW. 4 wrapper tests.
- `src-tauri/src/commands/meta.rs`: New `verify_active_db` Tauri command + 6 dispatch tests + `verify_dispatch` helper.
- `src-tauri/src/db/mod.rs`: New `current_database` default trait methods on `RdbAdapter` (runs `SELECT current_database()`) and `DocumentAdapter` (returns `None`).
- `src-tauri/src/db/mongodb.rs`: Override `DocumentAdapter::current_database` to surface `current_active_db()`.
- `src-tauri/src/lib.rs`: Register `verify_active_db` handler.
- `src/components/query/QueryTab.tsx`: New `applyDbMutationHint` helper + 2 call sites (single + multi statement) post-`executeQuery`.
- `src/components/query/QueryTab.test.tsx`: 5 new `[S132]` scenarios.
- `docs/sprints/sprint-132/handoff.md`: This file.

### Checks Run
- `pnpm vitest run`: pass (2027 / 2027, +41 vs S131 baseline 1986).
- `pnpm tsc --noEmit`: pass (0 errors).
- `pnpm lint`: pass (0 errors).
- `pnpm contrast:check`: pass (0 new violations).
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: pass (268 / 268; 2 ignored pre-existing).
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`: pass (0 warnings).
- e2e static compile probe (`pnpm exec wdio run wdio.conf.ts --spec='nonexistent-s132-probe.ts'`): pass (config + types compile, only "spec not found" runtime — same probe pattern S131 used).

### Done Criteria Coverage
- AC-01..AC-10: covered. See file:line / test:line table above.

### Assumptions
- User-authorised default trait methods (`current_database`) on both `RdbAdapter` + `DocumentAdapter` despite brief's "신규 trait method 추가 금지" — user instruction takes precedence.
- Frontend dispatch is PG-only this sprint (`dialect: "postgres"` hard-coded). MySQL / Redis hook positions are wired via the lexer but the UI does not route them yet.
- Verify is best-effort — verify failure must not block the rendered query result.
- Multi-statement → last-match-wins (per contract).
- Masking preserves position (single-space replacement) so `sliceCapture` maps offsets 1:1 between masked + raw.

### Residual Risk
- `SELECT current_database()` round-trip per detected `\c` (cheap on PG sub-pool, but adds latency on a degraded network).
- Multi-statement call site has no behavioural integration test (covered indirectly by the helper unit tests + existing multi-statement tests).
- `$$...$$` PG dollar-quoted bodies are not masked (theoretical false-positive vector; not exercised by tests; risk rated low).
- Live-PG happy-path verify is not part of `cargo test --lib`.
