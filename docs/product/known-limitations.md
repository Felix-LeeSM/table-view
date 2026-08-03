# Known Limitations

This page records current product-visible support boundaries. Future work items
live in [`docs/roadmap/follow-up-queue.md`](../roadmap/follow-up-queue.md) and
sequencing lives in [`docs/ROADMAP.md`](../ROADMAP.md). Historical risk IDs live
in [`docs/archives/risks/active-risk-register-2026-05-27.md`](../archives/risks/active-risk-register-2026-05-27.md).

The MySQL/MariaDB import/export boundary entry in
[`docs/product/known-limitations-rdbms.md`](known-limitations-rdbms.md) stays at
its current unshipped wording until #1641 (MySQL restorable dump) ships. #1639/#1640
(PostgreSQL CSV row-level import) has shipped — PostgreSQL now maps CSV columns
to a target table and commits one single-row INSERT per row through the shared
`execute_query_batch` command in a single all-or-nothing transaction (empty
fields map to SQL NULL or `''` via a tri-state toggle; other engines return
`Unsupported`), so the PostgreSQL entry records it as supported while DB-level
backup/restore/import/export stays a future gate. #1638 (tabular JSON export)
has shipped — grid JSON export is engine-agnostic (no capability gate) and now
serves table/query surfaces as an array of objects keyed by headers, so no
boundary entry claims it as unsupported. This page is not edited ahead of the
feature; the forward-looking Stage 1 scope boundary is owned by
[`docs/product/current-boundaries.md`](current-boundaries.md).

## Data Source Support

Per-source boundary entries moved to the child pages below. Each child keeps the
exact entry wording, and every entry keeps its area label and its current
limitation. Layout is per-page: an entry is either a row of the original
`| Area | Current limitation |` table or the equivalent heading section, because
#1842 unwraps those tables one page at a time.

- [`docs/product/known-limitations-rdbms.md`](known-limitations-rdbms.md) —
  PostgreSQL, MySQL/MariaDB, SQLite, DuckDB, MSSQL, Oracle.
- [`docs/product/known-limitations-non-rdbms.md`](known-limitations-non-rdbms.md) —
  Redis, Valkey, MongoDB, Elasticsearch/OpenSearch, wider source candidates.
- [`docs/product/known-limitations-cross-cutting.md`](known-limitations-cross-cutting.md) —
  credential lifecycle, connection import/export privacy, security/admin
  surface, runtime E2E smoke, adapter/workspace boundary, query results,
  ERD/FK, CHECK constraints.

## UI, Accessibility, And Performance

The following areas are product-visible but not yet backed by routine automated
smoke or measurement gates:

- Critical component smoke covers SchemaTree tree/treeitem roles, DataGrid
  grid/gridcell/edit feedback, Connection and Import/Export dialog labels/error
  regions, and secret-free alert/status/aria-live credential feedback.
- Full 72-theme light/dark WCAG AA measurement. One surface is swept: the
  selected data-row fill is asserted per theme and mode by
  `src/components/datagrid/DataGridTable.selection-contrast.test.tsx`. That is a
  separation floor between the fill and its own row background, not a WCAG
  criterion, and it covers no other pairing.
- SchemaTree 1k/10k table scroll FPS remains ungated. Current evidence is
  deterministic component fixtures plus advisory render p50/p95/env and
  virtualization DOM bounds only. SchemaTree now virtualizes by visible-row
  count for every shape (PostgreSQL `with-schema`, MySQL `no-schema`, and
  SQLite/DuckDB `flat`), not only `with-schema`; the shared BSON document
  tree (`BsonTreeViewer`), the Mongo database/collection tree
  (`DocumentDatabaseTree`), and the inline document tree
  (`DocumentTreePanel`) are virtualized too. FPS/latency gates for these
  surfaces remain future work.
- The inline document tree (`DocumentTreePanel` / `jsonTree`) caps a single
  cell's nested value at `MAX_TREE_DEPTH = 200` levels and `MAX_TREE_NODES =
  50,000` nodes — a defense against a hostile/malfunctioning DB server
  returning pathologically deep nesting (stack overflow) or an oversized
  document (main-thread freeze). Beyond either cap the tree renders a visible
  "…truncated" indicator instead of the full subtree. Above the shared
  virtualization threshold the panel windows its rows, so a capped cell only
  mounts a viewport-sized slice (the marker is reached by scrolling).
  Legitimate documents are far under both caps (MongoDB's own BSON nesting
  limit is 100).
- DataGrid page-size 1000 wheel-to-paint latency remains ungated. Current
  evidence is a deterministic page-size 1000 fixture plus advisory render
  p50/p95/env and virtualization DOM bounds only.
- VoiceOver/NVDA paths for Quick Open, DataGrid, and SchemaTree.
- The Quick Look panel is keyboard-reachable through `F6` (grid cell ↔ panel,
  and Escape inside the panel hands focus back without closing it), but that
  binding is not listed in the in-app shortcut cheatsheet — neither is the
  `Cmd/Ctrl+L` that opens the panel. Tab does reach the panel because it is the
  grid's next sibling, but the grid's roving tabindex means Tab re-enters the
  grid at its single tab stop, not at the cell the user left. In the RDB grid
  with pending edits, Escape inside the panel also opens the discard confirm:
  that gate has no focus-position condition and the panel's Escape deliberately
  does not consume the event, so the collision fires from inside a panel field
  editor too — those do not stop propagation either. The document grid has no
  Escape discard gate at all, so it does not have the collision.
- Quick Look grows its long-value editors to fit their content with the CSS
  `field-sizing` property, which needs Chromium 123+ or WebKit 26+. On an older
  engine those editors fall back to their fixed `rows` height and scroll, as
  they did before — no regression, just no improvement. The `<pre>` branch drops
  its height clamp regardless of engine. Raising this to a measured floor waits
  on a declared minimum supported platform.
- Quick Open cross-connection results are global (every connected source) and
  selecting another connection's result jumps to that connection's workspace
  window. The window focus/create is reliable, but the forwarded action (open
  the table tab / reveal the schema) is best-effort for a not-yet-open target
  window because of a Tauri-event mount race; guaranteed replay-on-mount for a
  fresh window is a follow-up.
- Candidate-source UI accessibility smoke.
- 1024x600 minimum viewport with max sidebar and dialog overlap. The workspace
  toolbar's Layout cluster collapses the schema sidebar, so a user cramped at
  that size can reclaim the column by hand. The collapsed state is session-only
  — reopening the workspace window starts expanded again, and the sidebar width
  the user dragged is likewise not restored across a restart. The overlap
  itself stays ungated.
- Tauri production shortcut audit for `Cmd+Shift+I`.
- `MainArea` empty-state MRU policy.
- Narrow-column display for `pendingEditErrors`.
- ERD layout persistence, semantic zoom, viewport virtualization, virtual FKs,
  focus filters, and diagram export. The React Flow + elkjs canvas ships without
  them; each is a separate follow-up issue. Dragged node positions are lost when
  the ERD tab is reopened.
- There is no internal-doc link checking, and Node package audit is deferred.
  Rust dependency security is covered by blocking PR/main `cargo deny check`;
  runtime dependency upgrades remain separate PRs.
- Broader E2E fixture reset coverage. Current runtime smoke separates app data
  directories from external DB resets and resets the matching fixture before
  each wired spec. That does not add Cassandra, DynamoDB, graph, vector, stream,
  or broader MSSQL/Oracle/Search service coverage.

## Query Results

- Raw query results are capped at a configurable row limit (default 10,000
  rows; adjustable 100–1,000,000 via the workspace toolbar row-cap control,
  persisted as the `query_row_cap` setting). The cap is enforced at fetch
  time across every DBMS — the backend stops pulling rows past the cap rather
  than buffering the full result set, so a no-`LIMIT` JOIN cannot exhaust
  memory. When a result is capped the grid shows a truncation banner and the
  row count reflects the returned (capped) rows, not the true total. Add an
  explicit `LIMIT`/`TOP`/`FETCH` clause for precise control, or raise the cap.
  Oracle fetches in ~100-row batches, so it may transiently buffer up to one
  batch beyond the cap before trimming to exactly the cap. Write (rows-affected)
  results and the dedicated Explain plan viewer are not capped; a raw `EXPLAIN`
  typed into the editor streams through the cap like any other SELECT (its plan
  output is well under the default).

## Auto-Update Platform Coverage

In-app auto-update (ADR 0049) reaches only the platforms present in the release
`latest.json` manifest — currently `darwin-aarch64`, `windows-x86_64`, and
`linux-x86_64` (see
[`docs/contributor-guide/release/versioning-and-artifacts.md`](../contributor-guide/release/versioning-and-artifacts.md)).
Installs outside those keys do not auto-update:

- **Intel Macs (`darwin-x86_64`)**: the macOS release is Apple Silicon (arm64)
  only; there is no Intel bundle built. An Intel Mac is therefore not a supported
  install or auto-update target. If an arm64 build is run through translation,
  the updater finds no `darwin-x86_64` key in `latest.json`, so `check()` reports
  "up to date" and the update silently no-ops (updater errors are DEV-log-only,
  ADR 0036, no telemetry). Intel Mac users must install and upgrade manually from
  the GitHub Release assets.
- **Linux `.deb`/`.rpm` installs**: cannot self-update (no writable in-place
  target); the app shows a package-manager hint instead of an install prompt
  (#1437). Only the Linux AppImage bundle self-updates.

## Related

- [`docs/product/current-support-snapshot.md`](current-support-snapshot.md) — current support snapshot
- [`docs/roadmap/follow-up-queue.md`](../roadmap/follow-up-queue.md) — open follow-up queue
- [`docs/ROADMAP.md`](../ROADMAP.md) — promotion order
- [`docs/contributor-guide/testing-and-quality.md`](../contributor-guide/testing-and-quality.md) — developer-facing verification gaps
