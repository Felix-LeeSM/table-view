# Feature Spec: UX Laws — Top 6 Action Plan (Sprints 176–180)

## Description

This spec converts the five remaining items of `docs/ux-laws-action-plan.md` (originally derived from `docs/ux-laws-mapping.md` Top 6, items 2–6) into independently shippable sprints — Selective Attention (§A), Law of Similarity / Mongo MQL coloring (§B), Postel's Law for ConnectionDialog (§C), Mental Model paradigm vocabulary (§D), and Doherty + Goal-Gradient async progress with cancel (§E). Each sprint targets a separate UX law and a different surface (overlay layer, history list, connection input, paradigm-aware labels, async UX), so they can be ordered A→B→C→D→E without coupling — except §E which depends on §A's overlay click-through fix because the §E cancel button must live on the same overlay surface that §A is hardening. The work matters because the existing app has shipped paradigm-aware infrastructure (`QuerySyntax` dispatcher, `DOCUMENT_LABELS`, `cancel_query` command for SQL execution) but still has user-visible gaps where the infrastructure is not yet consumed; this spec closes those gaps without reinventing the foundation.

## Sprint Breakdown

### Sprint 176: Selective Attention — overlay pointer-event hardening + first-render flash gate

**Goal**: Prevent user pointer events on grid cells from passing through a refetch-loading overlay, and prevent the structure panel from flashing an empty-state message during its first fetch. Resolves RISK-009 + RISK-035.

**Verification Profile**: `mixed` (browser + command)

**Acceptance Criteria**:

1. `AC-176-01`: While an RDB grid is in the "refetch" loading state (data already present, new fetch in flight), pointer events targeting visible row cells underneath the loading overlay do not reach the underlying grid handlers (no row selection, no double-click cell-edit entry, no context menu). Verifiable via a Vitest assertion that fires `mouseDown`/`doubleClick` on the overlay region and asserts the grid's row handler was NOT invoked, AND verifiable in the running app by hovering during a slow refetch (the overlay swallows the click).
2. `AC-176-02`: Every other loading overlay surfaced by the audit (currently `DocumentDataGrid` and any further matches found by grepping for absolute-positioned full-bleed loading layers in `src/components`) follows the same blocking behavior. The audit result (file path + line) is committed to the sprint findings document so the Evaluator can re-grep and confirm coverage.
3. `AC-176-03`: The `StructurePanel` does NOT render any "no columns / no indexes / no constraints found" empty-state message during the time window between the panel mounting and its first fetch resolving. Verifiable via a Vitest test that mounts the panel with a never-resolving fetch and asserts none of the empty-state strings (e.g. `"No columns found"`) appear in the DOM.
4. `AC-176-04`: After all changes, the loading spinner's visual position, color, size, and animation are unchanged from the current behavior — confirmed by running the app and by component snapshot tests for the DataGridTable / DocumentDataGrid loading branch.
5. `AC-176-05`: `RISK-009` and `RISK-035` are moved from "active" to "resolved" in `docs/RISKS.md` with Resolution Log entries that name this sprint.

**Components to Create/Modify**:
- `src/components/datagrid/DataGridTable.tsx`: refetch loading overlay must not capture user pointer interactions destined for the grid below.
- `src/components/document/DocumentDataGrid.tsx`: same overlay-blocking guarantee as the RDB grid (audit-discovered second occurrence).
- `src/components/schema/StructurePanel.tsx`: empty-state messages must not be reachable before the first fetch settles.
- `docs/sprints/sprint-176/findings.md`: audit listing every full-bleed loading overlay in `src/components` and confirming each is covered by AC-176-01/02 (or explicitly excluded with reason).
- `docs/RISKS.md`: status update + Resolution Log entries for RISK-009 and RISK-035.

---

### Sprint 177: Law of Similarity — paradigm-aware syntax highlighting in QueryLog

**Goal**: Render every executed-query preview surface with paradigm-correct syntax highlighting. Today, two of three preview surfaces (`QueryTab` and `GlobalQueryLogPanel`) already use the existing `QuerySyntax` dispatcher; the dock-style `QueryLog` panel still emits plain text. This sprint closes that gap so a Mongo query never appears with SQL keyword colors.

**Verification Profile**: `mixed` (browser + command)

**Acceptance Criteria**:

1. `AC-177-01`: When the `QueryLog` panel renders an entry whose `paradigm` is `"document"`, the rendered text contains at least one element bearing the Mongo-operator marker that is unique to `MongoSyntax` output (the existing `cm-mql-operator` class). Verifiable via a Vitest assertion that seeds the history store with a Mongo entry and queries the rendered DOM for that marker.
2. `AC-177-02`: When the `QueryLog` panel renders an entry whose `paradigm` is `"rdb"`, the rendered text contains the SQL keyword marker class used by `SqlSyntax` (`text-syntax-keyword`) AND does NOT contain the Mongo-operator marker. Verifiable via a Vitest assertion.
3. `AC-177-03`: A Mongo query persisted in the history with its `paradigm` field correctly populated never receives SQL coloring at the QueryLog rendering step (regression guard against the legacy-fallback trap noted in `queryHistoryStore.ts:75`).
4. `AC-177-04`: Rendering 50 history entries (mixed paradigms) in the QueryLog completes in a single render cycle without crashes and without any console errors / React warnings — measured by a Vitest test that mounts the panel with 50 seeded entries and asserts the absence of warnings on `console.error` mock.
5. `AC-177-05`: The two existing `QuerySyntax` consumers (`QueryTab`, `GlobalQueryLogPanel`) continue to render correctly — confirmed by their existing tests still passing.

**Components to Create/Modify**:
- `src/components/query/QueryLog.tsx`: replace the plain-text query rendering with the paradigm-aware preview that already exists in `src/components/shared/QuerySyntax.tsx`.
- `src/components/query/QueryLog.test.tsx`: new (or extended) test file covering AC-177-01 through AC-177-04.

---

### Sprint 178: Postel's Law — connection input normalization (URL paste autodetect, trim, host:port split)

**Goal**: Make the ConnectionDialog accept the inputs users naturally produce: a connection URL pasted into the host field, a host with embedded `:port`, and stray surrounding whitespace. The dialog already has an explicit "URL" mode toggle and a `parseConnectionUrl` helper supporting postgresql/postgres/mysql/mongodb/redis/sqlite; this sprint extends acceptance to the form-mode host field, adds whitespace tolerance on save, splits `host:port` syntax, and adds two missing schemes.

**Verification Profile**: `mixed` (browser + command)

**Acceptance Criteria**:

1. `AC-178-01`: When the user pastes a recognized connection URL (postgres / postgresql / mysql / mongodb / mongodb+srv / mariadb / redis / sqlite-file-URL) into the host field while the dialog is in form mode, the dialog populates `db_type`, `host`, `port`, `user`, `database`, and (where present) `password` from the URL within one user-visible step, and a non-modal affordance informs the user the URL was detected (e.g. an inline note or toast). Verifiable via Vitest tests that paste each scheme and assert the resulting form state.
2. `AC-178-02`: All string fields that the user would not deliberately bracket with whitespace (`name`, `host`, `database`, `user`, `group_name` if present, plus any SSH fields when introduced) have leading/trailing whitespace stripped before the connection is saved or tested. The `password` field is excluded — it is sent verbatim. Verifiable via Vitest tests on the save handler with whitespace-padded inputs and a snapshot of the outgoing payload.
3. `AC-178-03`: When the host field's value contains a single `:` followed by digits and the user blurs the field, the digit suffix is moved to the `port` field and the host field retains only the hostname portion. Pure IPv6 addresses (containing `[…]:port` or multiple `:`) are NOT misinterpreted — only single-colon `host:NNNN` triggers the split. Verifiable via Vitest tests covering IPv4-style and IPv6-style inputs.
4. `AC-178-04`: An input that begins with `://` or a known scheme but is malformed (e.g. `postgres://` with no host) leaves the host field's value untouched and does NOT raise an error toast — best-effort ingest, not a hard failure. Verifiable via Vitest tests asserting the input survives unchanged and no toast/alert role is added to the document.
5. `AC-178-05`: No password value (raw or URL-encoded) appears in any toast / error / aria-live region surfaced by this sprint's code paths. Verifiable via a Vitest test that pastes a URL containing a password, then asserts the password substring is absent from every `role="alert"` and `role="status"` node in the DOM.

**Components to Create/Modify**:
- `src/components/connection/ConnectionDialog.tsx`: form-mode host field gains URL-detection on paste; trim is applied on save; `host:port` split is applied on blur.
- `src/types/connection.ts`: `parseConnectionUrl` extends recognized schemes to include `mongodb+srv` and `mariadb` (currently only `postgresql/postgres/mysql/mongodb/redis/sqlite`).
- `src/types/connection.test.ts`: extend test suite for the new schemes and edge cases (encoded password, IPv6, `host:port` only).
- One sibling unit-test file in `src/components/connection/` covering AC-178-01 through AC-178-05 (paste, trim, split, malformed input, password leak guard).

---

### Sprint 179: Mental Model — paradigm-aware vocabulary in user-visible labels

**Goal**: Make user-visible labels match the paradigm of the open connection. Today, RDB labels ("Add Column", "Columns", "No columns found", "Add row") leak into Mongo contexts because some surfaces are still RDB-only-mounted (e.g. `StructurePanel`/`ColumnsEditor`) but other surfaces (e.g. `DataGridToolbar`) accept paradigm overrides via prop. This sprint introduces a single source of truth for paradigm vocabulary, extends the partial-coverage `DOCUMENT_LABELS` pattern to the rest of the user-visible surfaces, and wires the labels through.

**Verification Profile**: `mixed` (browser + command + static)

**Acceptance Criteria**:

1. `AC-179-01`: A single in-repo dictionary maps each supported paradigm (`rdb`, `document`, `search`, `kv`) to its user-visible vocabulary (unit / units / record / records / container / addUnit). Verifiable by file inspection — the dictionary is a typed constant exported from one module and the test file asserts each paradigm key has a complete entry.
2. `AC-179-02`: When a Mongo collection is the active table and a structure-or-fields surface is mounted (currently RDB-only `StructurePanel` is the gap), every user-visible mention of "column" / "columns" / "Add Column" / "No columns found" reads the equivalent Mongo vocabulary (field / fields / "Add Field" / "No fields found"). If `StructurePanel` is NOT mounted for Mongo today, the AC is satisfied by a build-time assertion (TypeScript or test) preventing it from being mounted with a `document` paradigm without paradigm-correct copy. Verifiable via Vitest tests that render the surface with `paradigm="document"` and assert the Mongo vocabulary appears.
3. `AC-179-03`: Existing RDB callers continue to render the existing RDB vocabulary unchanged. Verifiable by the existing component test suite (StructurePanel, DataGridToolbar) passing without modification beyond paradigm-prop additions.
4. `AC-179-04`: When the `paradigm` prop is missing or undefined at a label boundary, the system falls back to the RDB vocabulary so legacy callers do not surface "Field" labels in an SQL context. Verifiable via a Vitest test that passes `undefined`.
5. `AC-179-05`: An audit report committed to the sprint folder lists every user-visible "column" / "table" / "row" string in `src/components/**.tsx` after the change, classifies each as paradigm-aware (sources its label from the dictionary) or paradigm-fixed (legitimately RDB-only, with reason), and shows zero hardcoded paradigm-RDB labels in user-visible JSX of paradigm-shared components.

**Components to Create/Modify**:
- `src/lib/strings/` (new sibling to existing `document.ts`): a paradigm dictionary module exposing all paradigm vocabulary as one typed object.
- `src/lib/strings/document.ts`: kept; the existing `DOCUMENT_LABELS` constant is sourced from the new dictionary.
- `src/components/datagrid/DataGridToolbar.tsx`: existing label-prop overrides default to the dictionary's RDB vocabulary; document caller already overrides via `DOCUMENT_LABELS` and continues to do so.
- `src/components/schema/StructurePanel.tsx`: tab labels and empty-state copy read from the paradigm dictionary.
- `src/components/structure/ColumnsEditor.tsx`: "Add Column" button label and "No columns found" empty-state copy read from the dictionary.
- `docs/sprints/sprint-179/labels-audit.md`: AC-179-05's audit report.

---

### Sprint 180: Doherty + Goal-Gradient — async progress overlay with cancel for four operation vectors

**Goal**: Add a uniform "1-second-threshold progress overlay with Cancel" to the four user-perceived async operations: data fetch, query execution, schema/structure load, and refetch. Today only one vector — RDB query execution via `execute_sql` + the `cancel_query` command — supports backend cancellation. This sprint extends cancellation support to the three remaining vectors and ships the unified frontend overlay. Depends on Sprint 176 because the cancel button must live on the overlay surface that Sprint 176 hardens.

**Verification Profile**: `mixed` (browser + command + api)

**Acceptance Criteria**:

1. `AC-180-01`: After approximately 1 second of an in-flight async operation (any of: row data fetch, query execution, schema fetch, refetch), a progress affordance with a visible "Cancel" control becomes user-reachable on the affected surface. Operations that complete in less than 1 second do NOT show the affordance — a fast operation produces no overlay flicker. Verifiable via Vitest tests using a controllable promise with fake timers (assert no overlay before the threshold, overlay after).
2. `AC-180-02`: Activating the Cancel control causes the in-flight operation to abort. The frontend's loading state clears within one frame of the cancel response, and the user-visible content reverts to the pre-fetch state (or an empty/idle state if there was no prior content). Verifiable via Vitest tests on each of the four vectors.
3. `AC-180-03`: For RDB connections, an aborted query records a history entry whose status field carries a value distinct from "success" / "error" (e.g. `"cancelled"`), discoverable via the existing `queryHistoryStore` selectors. Verifiable via Vitest test that intercepts the cancel path and inspects the resulting entry.
4. `AC-180-04`: For RDB and Mongo adapters, the backend confirms in-flight cancellation: a long-running PG query (`pg_sleep(N)` with N≥3) and a long-running Mongo operation are both verifiable as having stopped consuming server time after the cancel. SQLite (and other adapters where in-flight cancel is impossible) declare a documented best-effort policy in the same sprint, captured in a new ADR. Verifiable via integration tests for PG and Mongo, and by file inspection for the ADR.
5. `AC-180-05`: A second attempt at the same operation immediately after cancelling the first proceeds normally — no stuck loading state, no orphaned cancel-token, no race that surfaces the cancelled response after the second attempt's response. Verifiable via a Vitest test that triggers cancel→retry on each of the four vectors and asserts the second attempt succeeds with its own data.
6. `AC-180-06`: All four async vectors share the same Cancel UX (button copy, position relative to the spinner, keyboard reachability) — verifiable by component test that renders all four host surfaces during a long async and asserts the overlay carries the same accessible name and the same data-test attribute.

**Components to Create/Modify**:
- `src-tauri/src/db/mod.rs`: the trait surface that today only adds `Option<&CancellationToken>` to `execute_sql` extends the cancel-token contract to the long-running RDB methods (`query_table_data`, `get_columns`, `get_table_indexes`, `get_table_constraints`) and to the equivalent Mongo trait methods.
- `src-tauri/src/db/postgres.rs` and `src-tauri/src/db/mongodb.rs`: implement cancel-token reception on the methods extended above, observing the same cancellation behavior the existing `execute_sql` already shows.
- `src-tauri/src/commands/`: cancel-token registration and the existing `cancel_query` command surface extend to the new operations OR a generalized cancel command is introduced; the frontend invocation surface is uniform across vectors.
- `src/components/datagrid/DataGridTable.tsx`, `src/components/document/DocumentDataGrid.tsx`, `src/components/schema/StructurePanel.tsx`, and the refetch path in `src/components/rdb/DataGrid.tsx`: render the unified progress-with-cancel overlay on the existing loading surface.
- A new ADR under `memory/decisions/` covering the per-adapter cancel policy (in-flight vs best-effort; SQLite limitation explicit).

---

## Global Acceptance Criteria

1. `AC-GLOBAL-01`: All four verification commands pass after each sprint: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`, and (for sprints touching Rust — Sprint 180 only) `cargo build --manifest-path src-tauri/Cargo.toml` plus `cargo clippy --all-targets --all-features -- -D warnings`.
2. `AC-GLOBAL-02`: Every sprint that adds new user-visible behavior ships at least one Vitest test exercising that behavior — no production code without a test (`memory/conventions/memory.md`).
3. `AC-GLOBAL-03`: No regression in existing paradigm-aware areas: tests for `QuerySyntax`, `MongoSyntax`, `SqlSyntax`, `DOCUMENT_LABELS`, `parseConnectionUrl`, and `cancel_query` continue to pass without modification beyond extension.
4. `AC-GLOBAL-04`: Touched files achieve ≥ 70% line coverage for new code (project convention from `memory/conventions/memory.md`); each sprint's handoff cites the resulting numbers.
5. `AC-GLOBAL-05`: No `it.skip` / `it.todo` / `xit` introduced in touched files — the project's "skip-zero gate" (Phase 13+) holds across all five sprints.
6. `AC-GLOBAL-06`: No regression in the e2e suite shards already passing on `main`: any e2e test that selects content via text matchers affected by Sprint 179 paradigm-relabeling is updated in the same sprint.

## Data Flow

- **Sprint 176**: Pure DOM/state — no IPC change. The DataGridTable / DocumentDataGrid loading state behavior is reshaped (the overlay swallows pointer events without altering data flow).
- **Sprint 177**: Pure UI — `QueryLog` already reads `entries` from `useQueryHistoryStore`; the change replaces the plain-text rendering function with the existing `QuerySyntax` dispatcher. No store or IPC change.
- **Sprint 178**: ConnectionDialog now normalizes user input before save; the existing connection-test and connection-save IPC commands are unchanged. The `parseConnectionUrl` helper expands its scheme set; consumers receive richer `Partial<ConnectionDraft>` for the new schemes.
- **Sprint 179**: A new label-source module is introduced. Existing components consume it through props (the existing pattern shown by `DOCUMENT_LABELS` flowing into `DataGridToolbar`); no IPC or store change.
- **Sprint 180**: The `DbAdapter` / `RdbAdapter` / `DocumentAdapter` traits extend their cancel-token surface from `execute_sql` (already present) to the four operation vectors. A single cancel command (existing `cancel_query`, generalized or sibling-extended) routes to the registered tokens by id. The frontend's existing `fetchIdRef` race-protection pattern integrates with cancel: a registered token is cancelled before discarding the local fetch id, so backend resources are released as well as frontend state.

## UI States (per sprint where relevant)

- **Sprint 176** — Loading: spinner stays visually identical; under it, pointer events are blocked. Empty: never shown to the user before first fetch on `StructurePanel`.
- **Sprint 177** — Loading / Empty / Error: unchanged from current `QueryLog` (panel header, search input, entries list); the per-entry rendering swaps from plain text to paradigm-aware highlighted preview.
- **Sprint 178** — Idle: the form-mode host field accepts a URL paste and reformats into separate fields. Error: malformed URL leaves the host field unchanged with no toast (silent best-effort). Success on save: the saved connection has trimmed string fields.
- **Sprint 179** — All paradigms render their own vocabulary in every user-visible label slot (toolbar, structure tabs, empty states, action buttons). Loading / Error states keep their current copy unless the copy itself contains paradigm-specific wording, in which case it is sourced from the dictionary.
- **Sprint 180** — Idle (<1s): no overlay change beyond the existing spinner. After ≈1s: progress affordance with Cancel control becomes reachable. After cancel: idle / pre-fetch state, history-entry status reflects cancellation. Error: any post-cancel error path surfaces in the existing error UI without showing the cancelled operation as "errored."

## Edge Cases

- **§A.4 / Sprint 176**: A user clicks/double-clicks intentionally on the spinner area expecting some action — current code has no such intent, but the audit must confirm. Playwright e2e tests that target the spinner region must not break.
- **§B.4 / Sprint 177**: Multi-line BSON Mongo entries truncated at the existing length boundary may cut JSON in mid-token; the truncation length must remain stable enough that the Mongo tokenizer (already lenient for malformed JSON per `MongoSyntax`) does not throw.
- **§B.4 / Sprint 177**: Performance — rendering many CodeMirror instances would be a regression; the existing `MongoSyntax` / `SqlSyntax` are span-based (not CodeMirror), so this risk is already mitigated by the current implementation, but the sprint's render-many test confirms no future drift.
- **§C.4 / Sprint 178**: A user types a non-URL string that contains `://` (e.g. a free-form note) — the URL-detect heuristic must require a recognized scheme prefix, not just `://`, to avoid false positives.
- **§C.4 / Sprint 178**: `mongodb+srv://` carries SRV-record semantics that the frontend cannot resolve; the parsed result preserves the SRV host as-is for the backend to resolve.
- **§D.4 / Sprint 179**: Label-length differences ("Document" 8ch vs "Row" 3ch) may wrap in narrow toolbars; the verification at minimum window size (1024×600 — RISK-030) is part of Sprint 179's manual smoke.
- **§E.4 / Sprint 180**: SQLite's serial-execution model means the cancel token can only be honored at statement boundaries — declared in the ADR; not a regression, an explicit policy.
- **§E.4 / Sprint 180**: Cancel-token cleanup (tokens in `query_tokens: Mutex<HashMap>`) must avoid leaks across rapid cancel→retry cycles; the cancel path removes the token from the map before invoking `.cancel()` so the second attempt registers a fresh token without contention.
- **Cross-sprint**: e2e selectors that rely on hardcoded text labels affected by Sprint 179 must be updated in the same sprint; otherwise paradigm-aware text breaks the suite (already documented as a §D risk).

## Visual Direction

- **Sprint 176**: No visual change is the goal — the overlay must keep its current opacity, color, blur, and spinner geometry while changing only its pointer-event behavior.
- **Sprint 177**: The QueryLog entry rows match the visual treatment used by `QueryTab` and `GlobalQueryLogPanel` today — Mongo entries gain the operator-color treatment that already exists in those two surfaces, RDB entries keep the SQL keyword treatment.
- **Sprint 179**: Labels remain in the existing typography and tone; the swap is purely lexical. No layout change is intended; if a label-length difference at 1024×600 forces wrap or truncation, the truncation must be visually graceful (ellipsis, not clipped baseline).
- **Sprint 180**: The progress overlay shares the existing loading-overlay's mood (subtle, non-distracting). The Cancel control is a calm secondary action — not destructive in tone, since cancel is recoverable. The copy is "Cancel" (single word).

## Verification Hints

- **Sprint 176**: `pnpm vitest run src/components/datagrid/DataGridTable.test.tsx src/components/schema/StructurePanel.test.tsx`. Browser: open any RDB grid, hit refresh during a slow fetch, confirm clicks under the overlay don't reach rows. Static: confirm `findings.md` lists every full-bleed loading overlay.
- **Sprint 177**: `pnpm vitest run src/components/query/QueryLog.test.tsx src/components/shared/QuerySyntax.test.tsx`. Browser: with a Mongo connection, run a `find` query and toggle the QueryLog panel — the recorded entry should render with operator coloring matching `QueryTab`.
- **Sprint 178**: `pnpm vitest run src/types/connection.test.ts src/components/connection/`. Browser: open ConnectionDialog in form mode, paste `postgres://u:p@h:1234/db` into host, confirm fields populate. File inspection: confirm `parseConnectionUrl` enumerates `mongodb+srv` and `mariadb`.
- **Sprint 179**: `pnpm vitest run src/components/datagrid/DataGridToolbar.test.tsx src/components/schema/StructurePanel.test.tsx src/components/structure/ColumnsEditor.test.tsx`. Static: review `docs/sprints/sprint-179/labels-audit.md`. Browser: open a Mongo collection's structure surface (or, if not mounted, confirm the build-time assertion fires).
- **Sprint 180**: `pnpm vitest run src/components/datagrid/DataGrid.test.tsx src/components/rdb/DataGrid.test.tsx src/components/document/DocumentDataGrid.test.tsx src/components/schema/StructurePanel.test.tsx`. Backend: `cargo test -p src-tauri commands::rdb::query` and the Mongo equivalent. Browser: with a PG connection, run `SELECT pg_sleep(3)` and Cancel after 1.5s — the loading state clears, the history entry is recorded as cancelled.

## Discrepancies vs Action Plan

The action plan was written 2026-04-30 and prescribes implementation steps; some claims have shifted versus current code. None invalidate the sprint goals, but the AC has been re-anchored to observable behavior so the Generator does not regress past existing infrastructure.

1. **§A.1 — `DataGridTable.tsx:829-833` and `StructurePanel.tsx:27`**: Confirmed. Lines match.
2. **§A.1 — Other overlay candidates**: `DocumentDataGrid.tsx:325` is the only second match for `absolute inset-0` in `src/components`. No `EditableQueryResultGrid` / `QueryResultGrid` / `SchemaTree` skeleton matches were found by grep at this date. The audit AC (AC-176-02) preserves the discovery requirement.
3. **§B.1 — `QueryLog.tsx:115` plain text + `queryHistoryStore.ts:18,75`**: Confirmed. The `truncateSql(entry.sql, 80)` plain-text rendering is at line 115; the `paradigm`/`queryMode` fields are required on `QueryHistoryEntry` (lines 18–32) and the legacy fallback is at lines 74–79. The dispatcher already exists at `src/components/shared/QuerySyntax.tsx` and currently accepts an unused `queryMode` prop (forward-compat noted in `QuerySyntax.test.tsx:37-53`).
4. **§B.2 — performance concern about CodeMirror instances**: `MongoSyntax` and `SqlSyntax` are NOT CodeMirror-based; they emit `<span>` token trees. The performance risk in the action plan is therefore mitigated by the existing implementation. AC-177-04 has been kept as a regression guard.
5. **§C.1 — "host paste of `postgres://` URL fails"**: ConnectionDialog already has a separate explicit `Form ↔ URL` mode toggle (lines 341–426) and `parseConnectionUrl` covers `postgresql/postgres/mysql/mongodb/redis/sqlite`. The remaining gaps that this sprint targets are: (a) auto-paste detection on the form-mode host field (currently the user must explicitly switch to URL mode), (b) trim on save (currently only validation `.trim()` checks exist), (c) `host:port` split on blur (does not exist), (d) `mongodb+srv` and `mariadb` schemes (not in the current scheme map at `connection.ts:212-218`). The AC have been re-anchored accordingly.
6. **§C.2 — "create `src/lib/connection/urlParser.ts`"**: The action plan prescribes a new module. The Generator can choose: (a) extend the existing `parseConnectionUrl` in `src/types/connection.ts` (line 192) or (b) extract it. The AC describe behavior, not module location, per the planner rule.
7. **§D.1 — `ColumnsList.tsx`**: This file does NOT exist in the repo. The closest match is `src/components/structure/ColumnsEditor.tsx`, which contains the `"No columns found"` empty-state string at line 643 and the `"Add Column"` label at line 504. AC-179-02 references the actual file.
8. **§D.1 — `DataGridToolbar` "Add Column" hardcoded**: The toolbar already accepts `addRowLabel` / `rowCountLabel` props with RDB defaults; `DOCUMENT_LABELS` already overrides them from `DocumentDataGrid` (verified at `DocumentDataGrid.tsx:273-276`). The pattern exists; this sprint extends it to the structure surfaces, not the toolbar.
9. **§D.2 — "create `src/lib/paradigm/labels.ts` and `useParadigmLabels` hook"**: Implementation prescription. The AC instead requires "a single in-repo dictionary" with paradigm symmetry — the Generator chooses the location/shape consistent with the existing `src/lib/strings/document.ts` pattern.
10. **§E.1 — "Tauri `invoke()` cancel is not supported, every method must add a cancel token"**: Partially outdated. `cancel_query` (`src-tauri/src/commands/rdb/query.rs:130`) and `CancellationToken` plumbing through `execute_sql` (`db/postgres.rs:443`, `db/mod.rs:194`) already exist. Per-vector cancel for `query_table_data`, `get_columns`, `get_table_indexes`, `get_table_constraints`, and the Mongo equivalents is what's still missing. AC-180-04 names this scope precisely.
11. **§E.4 — "PR size, sub-sprint split"**: Out of scope for this spec. Sprint 180 stays single; the Generator may propose internal sub-tasks but the AC are uniform across vectors.

## Additional Risks Surfaced During Reading

- **Sprint 177 risk**: The `paradigm` field on `QueryHistoryEntry` is typed `paradigm: Paradigm` (required at the type level) but `addHistoryEntry` accepts a payload where it's optional and defaults to `"rdb"` (`queryHistoryStore.ts:46-48,87-90`). If a Mongo call site forgets to pass `paradigm`, the Mongo entry silently saves with `paradigm: "rdb"` and Sprint 177's coloring goes wrong. AC-177-03 captures this regression-guard requirement; consider adding a lint/grep step in Sprint 177's audit to catch silent omissions at the call sites.
- **Sprint 180 risk**: The frontend's `fetchIdRef` race-protection pattern (`src/components/rdb/DataGrid.tsx:146-180`) currently bails out after a stale fetch resolves. With cancel added, a cancelled fetch's promise rejects rather than resolves; the existing `try/catch + setError` path now catches a "cancelled" error that should not surface as a user-visible error. AC-180-02 names this — the post-cancel UI must revert without an error message.
- **Cross-sprint risk**: `it.skip` / `it.todo` skip-zero gate is Phase 13+ policy. Any sprint that adds tests in skipped form (e.g. for SQLite cancel deferred to a future sprint) must register a `[DEFERRED-<ID>]` annotation per `memory/lessons/2026-04-27-phase-end-skip-accountability-gate/memory.md`.
