# Known Limitations — Cross-Cutting Data Source Boundaries

Boundary entries that are not owned by a single engine: credentials, security
and admin safeguards, runtime E2E smoke, adapter/workspace typing, and schema
relationship surfaces. Index and the per-engine entries live in
[`docs/product/known-limitations.md`](known-limitations.md).

## Cross-Cutting Boundary Entries

### Connection import/export privacy

The Import / Export Connections dialog uses an encrypted JSON envelope for
selected connections. Connection passwords and active-session DuckDB file
analytics registrations are not embedded in the export payload; imported
connections require password re-entry and file source re-registration.

### Credential lifecycle boundary

The current local-first credential contract covers save-password tri-state,
redacted connection lists, backend-only stored-password lookup for connection
tests, password-free import/export payloads, empty keyring fallback sentinel
writes, and secret-free credential feedback regions. Credential rotation, KDF
changes, ACL, cloud credential UI, code-signing, and provider-secret decisions
require a threat-model handoff before support claims.

### Connection store backup and recovery

The connection store keeps one backup of itself, `connections.json.bak`, beside
it in the app data directory. A save moves the file it replaces there when that
file holds connections or groups, and a successful load creates one for an
install that has none yet, so an install carries a backup from its first launch
after #2183 rather than from its next edit. A launch that finds
`connections.json` gone restores it from that backup and warns in the log, and
raises a sticky toast naming the file when the backup put something back; a
launch that finds neither file starts empty and says nothing, because there is
nothing to put back.

That protection comes with boundaries. Only one generation is kept, so a save
made after the last backup rotation is not recoverable — the backup is the state
before the most recent write that had something to replace, not the most recent
write. The backup lives inside the app data directory, which is the deliberate
trade-off (owner decision 2026-08-06): anything that removes that directory
wholesale removes the backup with it, and the app has no copy elsewhere. A
backup that no longer parses restores nothing; it is moved to
`connections.json.bak.corrupt-<timestamp>` for manual recovery and the app
boots empty **without** a toast, so that case is visible only in the log. And
the corrupt-`connections.json` path does not consult the backup at all — a
store that fails to parse is still quarantined and replaced with an empty one,
with no notification and no automatic use of the copy sitting next to it.

An install with no connections and no groups gets no backup, which is why a
first run stays silent across launches rather than only on the very first.

### Security / admin surface

Destructive and admin safeguards are source-specific rather than universal.
Existing coverage includes RDB DDL preview/confirm, RDB Safe Mode confirmations,
MongoDB safety confirmations, Redis typed confirmation keys, and fixture/live
Search delete-by-query estimates plus live `_delete_by_query` execution behind
the Safe Mode confirm gate (index/settings admin execution still unsupported).
RDB Safe Mode is now enforced at the Rust IPC chokepoint
(`execute_query`/`execute_query_batch` and the destructive DDL commands), not
only by the frontend: the backend re-reads the persisted Safe Mode setting plus
the connection `environment` from its own SQLite store and refuses a destructive
statement that carries no confirmation proof, so a direct IPC `invoke`, a
frontend hydration race, or a tampered webview can no longer run destructive RDB
SQL unconfirmed. An unset/unresolved connection `environment` is deliberately
treated as allow (non-production) uniformly at every Safe Mode entry point
(#1114): untagged connections add no confirmation friction, and a production
connection that momentarily reads as unresolved during a frontend hydration race
is still covered structurally by the backend gate, which re-reads `environment`
from its own SQLite store; non-canonical stored tags ("Production", "prod")
canonicalize to unset and surface an "Unknown" badge rather than silently
masquerading as production. Issue #2375 widened the raw SQL/MQL editor's
preview gate from the warn tier to every tier above info. On a non-production
connection under Safe Mode `warn` / `off` the matrix returns `allow` for a
destructive statement, and before that widening `DROP TABLE t` dispatched on
the first click while `DELETE FROM t WHERE id = 1` got the preview dialog;
`DROP TABLE t` and a Mongo `$out` pipeline now open that same dialog
(`SqlPreviewDialog` / `MqlPreviewModal`). The Safe Mode decision matrix is
unchanged by the widening. The Redis command console mounts no preview at all
(`src/components/query/QueryTab/kvQueryExecution.ts`), so a destructive command
the matrix allows there still dispatches on the first click. Destructive
classification reuses the native
`sql-parser-core` crate (the same parser the frontend compiles to WASM); the one
intentional divergence is the frontend's dynamic dry-run WARN→danger escalation,
a UI-only runtime escalation outside the Safe Mode decision matrix that the
static backend gate does not reproduce. The RDB SQL classifier
(`src/lib/sql/sqlSafety.ts`) uses a maximal known-statement roster and, per the
2026-07-02 decision, treats any statement no branch recognises as `other`/info
(fail-open, allow) rather than escalating an unknown to a warning — a deliberate
trade-off that keeps the classifier from surfacing friction on benign
unrecognised input while the backend IPC gate remains the final defense. The
roster explicitly registers benign utility/session statements (transaction
control, maintenance, benign PRAGMA reads) as a distinct `known-safe`
classification so "known benign" is auditable and distinguishable from the
fail-open bucket, and escalates session integrity switches that disable
FK/constraint/trigger enforcement (`SET FOREIGN_KEY_CHECKS=0`, `SET
session_replication_role = replica`, `PRAGMA foreign_keys = off`) plus
deferred/opaque or external-mount statements (`PREPARE`, `ATTACH`/`DETACH`) to
`warn` because they arm or hide a later destructive step. This is intentionally
the opposite of the Oracle path (`src/lib/sql/oracleSafety.ts`), which fails
closed (block) for anything outside its bounded slice because PL/SQL opacity
makes unknown statements unclassifiable. An always-true predicate on a bounded
write (`DELETE ... WHERE 1=1`) stays `warn` at the static tier by design and is
promoted to danger only by the dynamic dry-run row-impact escalation. Issue
#1529 adds a per-connection read-only gate: a connection the user flags
read-only rejects every write at the same Rust IPC chokepoint
(`execute_query`/`execute_query_batch` and the structured DDL commands) by
re-reading the persisted `read_only` flag from the backend's own store,
independent of Safe Mode and with no confirmation bypass. Write/read
classification reuses the native `sql-parser-core` parser — a precise AST
verdict where the statement parses
(`SELECT`/`SHOW`/`SET`/read-`EXPLAIN`/`SELECT`-bodied CTE are reads; every other
variant is a write) and a fail-open leading-keyword deny-list where it does not,
so unparseable reads still browse. The trade-off is that a side-effecting
function inside a positively-parsed read (`SELECT nextval(...)`) and an exotic
write verb outside the deny-list can slip through, with the server-side
`default_transaction_read_only` transaction mode as the precise upgrade. The
gate also covers the dry-run path (`execute_query_dry_run`), which
BEGIN/execute/ROLLBACKs the statement: because MySQL/MariaDB/Oracle DDL
implicit-commits, the rollback cannot undo a schema write, so a write dry-run on
a read-only connection is rejected up front. The read-only toggle is exposed in
the connection form for every write-capable server RDB engine
(PostgreSQL/MySQL/MariaDB/SQL Server/Oracle) plus the file engines' driver-level
read-only (SQLite/DuckDB), matching the engine-agnostic backend gate. Search
live HTTP errors are scoped to the active sidebar/detail/query/delete-preview
surface and redact credentials/full URLs; this is not a global audit log or
security dashboard. Search live HTTP/admin promotion remains owned by the Search
roadmap/milestone, not non-RDBMS lazy-loading workbench hardening. Global audit
logs, role/user/permission UI, credential rotation UI, keyring diagnostics,
actual live Search index/settings admin execution, and a general security
dashboard are not implemented. Per ADR 0058 (#1649), every TLS-capable engine
now stores one uniform posture — `sslMode`, one of
`disable`/`prefer`/`require`/`verify-ca`/`verify-full`, plus an optional
`caCertPath` — replacing the ADR 0053 (#1063) `(tls_enabled,
trust_server_certificate)` boolean pair, which `connections.json` reads only to
migrate stored connections and never writes back. The SQLite snapshot mirror is
the exception: it keeps both legacy integer columns and projects the posture
onto them on every save, so `verify-ca` lands in the mirror as `verify-full` and
`caCertPath` stays file-SOT-only. Unset stays the opportunistic driver `prefer`
default with a hint. Two combinations that the pre-#1649 backend refused to
connect at all cannot stay refusals, because the enum has no way to express one;
both fold upward. TLS on with no explicit trust decision folds to `verify-full`.
Trust the certificate with encryption off — which a pasted
`sqlserver://…?encrypt=false&trustServerCertificate=true` could store — folds to
`require` (encryption forced, certificate verification skipped), so a
contradictory combination still never becomes a plaintext connection. That
second fold is the one migration step that can stop a working connection: on the
five on/off TLS engines (MongoDB, Redis/Valkey, Elasticsearch/OpenSearch) the
adapters ignored `trust_server_certificate` while TLS was off, so a row stored
that way connected in plaintext before #1649 and now forces a TLS handshake that
fails loudly against a server with no TLS. Recovery is to set that connection's
posture back to `disable` or `prefer` by hand; on
PostgreSQL/MySQL/MariaDB/SQL Server/Oracle the pair was already refused at
connect time, so nothing that previously connected changed there. `verify-ca`
hands the CA file the user selects to the driver as a trust anchor, with
hostname verification kept on, on PostgreSQL/MySQL/MariaDB, SQL Server and —
since #2154 — Oracle. What it does to the rest of that driver's anchor set
differs — PostgreSQL/MySQL/MariaDB go through sqlx/rustls and add the CA on top
of the bundled public root list, SQL Server goes through tiberius/native-tls and
adds it on top of the OS system trust store, and Oracle goes through oracle-rs,
which seeds its root store from the CA file *instead of* the bundled roots.
Oracle is therefore the one engine where naming a CA narrows the anchor set;
elsewhere it can only widen it. On MongoDB,
Redis/Valkey, and Elasticsearch/OpenSearch the CA file is ignored and
`verify-ca` verifies
against the built-in public roots alone — never weaker than `verify-full`, but a
private-CA server stays unreachable on those five until their drivers' own CA
options are wired (#1649 follow-up). A `verify-ca` posture with no CA file is
rejected at the storage write boundary for every engine, and again at connect
time on PostgreSQL/MySQL/MariaDB, SQL Server and Oracle — the adapters that
resolve the full posture. The five on/off TLS engines have only the
write-boundary rejection, so a row hand-edited into `connections.json` still
reaches those drivers as plain `verify-full`; the connection *test* action also
runs without the write-boundary check, so on those five it can report success
for a posture the save then rejects. The sslmode
dropdown renders for PostgreSQL/MySQL/MariaDB and, since #2154, for Oracle.
PostgreSQL/MySQL/MariaDB offer `disable`/`prefer`/`require`/`verify-full`;
Oracle drops `require` on top of that, because its driver cannot encrypt without
verifying. `verify-ca` renders only for a
connection already stored with it, because the CA file picker is the follow-up
slice. A pasted URL that names a posture the engine's dropdown does not
offer — `sslmode=verify-ca` anywhere, and `sslmode=require` on Oracle — is
reported as a parameter that could not be reflected rather than dropped
silently. The on/off TLS engines
(MongoDB/Redis/Valkey/Elasticsearch/OpenSearch) expose an explicit opt-in "trust
server certificate" (skip-verify) checkbox, gated on TLS being on and carrying an
in-form warning; SQL Server keeps its skip-verify default when the engine is
first selected, with the same warning, and turning its encryption checkbox off
and back on returns to full verification rather than to skip-verify. Switching
the dbType never carries a skip-verify choice onto the next engine. Export strips
`caCertPath` the way it strips the Oracle wallet path, and import folds a
`verify-ca` envelope to `verify-full` and drops the CA reference, so the CA file
is re-selected on the importing machine exactly as the password is re-entered.
Oracle reads that same posture since #2154: `verify-full` and
`verify-ca` dial TCPS, `require` is rejected at connect, and the #1065 mTLS
wallet is a separate trust anchor that cannot be combined with a TLS-enabling
posture — naming both is rejected rather than resolved one way.
The CA reference follows the posture that named it: the sslmode
dropdown, the engine TLS on/off checkboxes (both directions), a dbType switch,
and a pasted URL that states a posture all clear `caCertPath` whenever they move
the posture. The skip-verify checkbox is the deliberate exception — it keeps the
anchor while the posture sits at `require`, so unchecking it restores
`verify-ca` instead of demoting the connection to `verify-full`. A connection
saved while that box is checked therefore stores `require` with its CA path
still attached, and no posture reads that path until the box is cleared again.
Three posture-lifecycle limits ride along with the new vocabulary.
Rolling back to a pre-#1649 build loses the posture permanently: the storage
envelope carries no version field and does not reject unknown keys, so an older
build reads every connection as the legacy `(unset, unset)` pair and the first
save from that build drops `sslMode` and `caCertPath` for good. A CA path is
validated for presence only — a path that does not exist, or points at
something that is not a certificate, is stored and only surfaces as the driver's
raw error at connect time. One unrecognized `sslMode` string quarantines the
whole connection store: the enum has no catch-all variant, so the parse fails,
`connections.json` is moved aside as `connections.json.corrupt-<timestamp>`, and
the app boots with zero connections until that file is repaired by hand. The
`connections.json.bak` backup described under *Connection store backup and
recovery* is not consulted on this path — it covers a store that goes missing,
not one that fails to parse. Advanced
depth — client certificates, TOFU certificate pinning, the in-form CA file
picker, and private trust anchors on the five on/off TLS engines — remains a
follow-up (#1649).

### Runtime E2E smoke coverage

GitHub Runtime Happy Path currently builds the app on Ubuntu and runs
PostgreSQL, MySQL, MariaDB, SQLite, DuckDB, DuckDB file analytics, MongoDB,
Redis, Valkey, Elasticsearch, OpenSearch, MSSQL, and Oracle smoke specs.
PostgreSQL smoke includes a bounded Structure table-plus-index DDL path with
history/source and schema refresh proof; it does not widen roles/users,
extension management, profiler, import/export, broader admin, or broader
structured DDL parity. MySQL and MariaDB smoke include narrow seeded CALL result
rendering plus bounded Structure table/index/FK DDL
preview/execute/catalog-readback proof; they do not widen trigger CRUD, DB
dump/import/admin, vendor-workbench parity, or broader stored-routine/body
workflows. SQLite smoke covers deterministic file create/open, table browse,
read query, writable DML, row edit, bounded structured table creation with
schema refresh proof, read-only write rejection, and internal app-state DB
rejection. The rest of the DDL #1804 opened is proved by adapter-level tests
rather than by this smoke, and neither widens raw SQL DDL, ALTER rebuilds,
standalone constraint changes, nested JSON edit, sqlite-cli execution, or
extension/capability semantics. DuckDB `.duckdb` smoke covers deterministic
`.duckdb` open, catalog/table browse, raw SELECT tabular result/history
evidence, writable DML readback, and read-only write rejection; it does not
widen DuckDB structured DDL/write UI parity. DuckDB file analytics smoke covers
registered deterministic CSV source -> global editor SELECT -> result grid ->
`FILE` history/source evidence -> no absolute local path in visible UI; it does
not widen automatic import/export workflows, COPY/ATTACH/DETACH, extension
install/load, raw external-file SQL functions, structured DDL/write UI, or admin
parity. MySQL and MariaDB coverage also includes the
connect/browse/query/edit/cancel/history/result-envelope baseline, and MariaDB
includes a bounded catalog/workbench metadata probe for
tables/views/columns/indexes/constraints/FKs/routine metadata. MSSQL smoke
covers representative SQL Server connect, seeded catalog browse, SELECT/DML,
destructive Safe Mode confirmation, cancellation, and grid edit for the bounded
catalog/query/cancel/tabular/edit-row slice; it does not claim structured DDL,
admin, import/export, full T-SQL parity, or SQLCMD/procedure-body scripting
support. Oracle smoke covers representative service-name connect, seeded
catalog/routine browse, SELECT/DML, destructive Safe Mode confirmation,
cancellation, and grid edit for the bounded
catalog/query/cancel/tabular/edit-row slice; it does not claim
SID/TNS/wallet/advanced auth, structured DDL, raw DDL/admin, full
parser/completion promotion, PL/SQL body/package work, admin, import/export, or
full workbench parity. MongoDB smoke covers seeded collection browse, row-edit
MQL preview/execute, query-tab `find` projection/sort/limit, destructive
`runCommand` confirmation, and cancel/no-mutation re-read for the whitelisted
document workflow only. Redis smoke covers DB 2 fixture reset, connection, key
scan, string preview, `GET` command result, guarded string overwrite, TTL
update, and exact-key delete confirmation. Valkey smoke covers DB 2 fixture
reset, connection, key scan, string preview, `GET`, `HGETALL`, `XRANGE`, bounded
`SET`/`EXPIRE` DML summaries with readback/TTL verification, and
destructive/unsupported command guards; focused backend/component evidence
covers the shared string plus hash/list/set/zset mutation controls (#1075),
while full Redis compatibility remains a future gate. Elasticsearch/OpenSearch
smoke covers live service connect/auth/TLS contract, catalog/index detail
metadata, bounded `_search` rendering, delete-by-query safety planning plus live
`_delete_by_query` execution behind a Safe Mode confirmation, and visible error
surface; it does not widen actual live admin (index/settings) execution, broader
Search observability workflows, or product-specific destructive deltas. The
`_search` `profile` plan is separate and does ship — see
[known-limitations-non-rdbms.md](known-limitations-non-rdbms.md).
MySQL catalog metadata has integration evidence for databases/schemas, tables,
views, columns, indexes, constraints/FKs, and live version-gated column CHECK
hints. MySQL row-edit generated SQL parity, catalog-aware completion context,
MongoDB catalog/autocomplete/bulk/index/validator/parser/cancellation slices,
MariaDB row-edit parity, Redis bounded command allowlist/dispatch plus
command/key completion paths, Valkey exact-key confirmation success paths, MSSQL
catalog/query/cancel/tabular/edit-row runtime paths and parser/completion
boundary guards, Oracle catalog/query/cancel/tabular/edit-row runtime and Safe
Mode/editor-assistance boundaries, and OpenSearch
root-probe/catalog/query/destructive-plan/mapping-aware autocomplete paths have
focused generator/hook/component/backend/core tests below full parity.
Completion runtime smoke, trigger CRUD, admin/import/export parity, MongoDB
native document-first panels, MSSQL DDL/admin/full T-SQL widening, Oracle
SID/TNS/wallet/advanced-auth/DDL/admin/PLSQL widening, and additional desktop
smoke scenarios remain separate gates. Static fixture inventory covers
SQL/MongoDB/Redis/Valkey/Search seed contracts, but other specs under
`e2e/smoke/**`, reset-to-default audits, additional file analytics scenarios
beyond the wired `duckdb-file-analytics` spec, broader Search scenarios, and
macOS/Windows runtime smoke are future promotion gates unless a smoke runner
wires them. The dense ERD scenario is wired — see the ERD / SchemaGraph section
below.

### Adapter / workspace boundary

Backend commands regain typed adapters through `ActiveAdapter::as_rdb` /
`as_document` / `as_search`, and profile/conformance metadata declares adapter
families. Frontend query dispatch still lives in `useQueryExecution`, and query
tab/result lifecycle lives in `workspaceStore`; further decomposition is
refactor/quality work, not a support claim. Active connections resolve through a
short-lock `Arc` clone (`AppState::active_adapter`) so a long-running query
never serialises other connections or native cancel behind it; consequently the
opt-in `expected_database` mismatch guard is best-effort, not atomic. A
concurrent same-connection database switch landing between the guard's probe and
the dispatch is a narrow known race the guard cannot catch (restoring true
atomicity would need an adapter-level checked-execute API); switching a
connection's database while a query is in flight on that same connection is the
only exposure.

### Query results

RDBMS IPC is normalized to a `tabular` result envelope at the Tauri wrapper
while legacy `QueryResult` remains the renderer compatibility projection.
`tabular` and `document` can project to `QueryResultGrid`, Search uses a
separate typed renderer state for hits, shard/timeout metadata, aggregations,
explain/profile payloads, and malformed/loading/error states, and generic
KV/stream/metrics-style envelopes do not have a shipped grid projection.
Redis/Valkey command allowlist tests cover selected tabular read projections and
DML summary rendering, and Runtime Happy Path smoke covers representative
command results through the query result surface; the command editor completion
surface does not widen result-envelope support.

### ERD / SchemaGraph

schemaStore owns cached
schemas/tables/views/functions/postgresExtensions/tableColumnsCache/tableIndexesCache/tableConstraintsCache/triggers.
Production ERD/SchemaGraph input comes from schema/table/column cache plus
cached/fetched explicit indexes/constraints for visible tables; `ColumnInfo`
still supplies synthetic PK/FK/CHECK fallback metadata. The ERD includes a
read-only selected-table dependency view for incoming/outgoing FKs, related
indexes/constraints, CHECK expressions, and metadata/SchemaGraph diagnostics.
The DDL preview/confirm flow includes cached SchemaGraph migration-impact
summaries for table/column/constraint/index removals without changing backend
SQL generation or execution semantics. Cached same-source and cross-source RDBMS
schema diff is read-only; it does not apply migrations, compare data,
import/export, expose admin workflows, or include DuckDB registered file
aliases. That diff also marks the diagram: a card whose table a diff entry names
carries one badge per change kind — added, removed, changed — and the card's
outline follows the entry for the table itself, so a newly added table reads
apart from a surviving one whose columns alone moved. No mark is read from
colour alone: a badge pairs its hue with an icon shape and the outline pairs the
same hue with a line pattern. The card's accessible name repeats its kinds,
because the card is a button and ARIA drops a button's contents from the
accessibility tree. A column the diff touched carries the same badge on its row
when the card draws that row; the viewport zoom decides which columns a card
draws, and a touched column it leaves out is only counted in the hidden-columns
line. The
canvas draws the current schema, so a table or a column that exists only in the
comparison snapshot has no card or row to mark and stays a diff-panel row; a
surviving table whose column was dropped is what carries the removed badge.
Marking is presentation only and never re-runs the layout, so picking a
comparison leaves every node where it was.
The ERD is opened as a database-level diagram tab from the schema-tree
header action (gated on the engine's `intelligence.erd` capability), not from a
per-table sub-tab. The diagram is a `@xyflow/react` canvas with `elkjs`
`layered` auto-layout: referenced tables rank above the tables that reference
them, and nodes can be dragged, but positions are not persisted across tab
reopen. How much of a table a card spells out follows the viewport zoom in three
steps — the table box alone, then the primary-key and foreign-key columns, then
every column — and a card that leaves columns out says how many it hid. There is
no fixed cap on rendered columns. Zoom never re-runs the layout: elkjs is handed
the full-detail height of every card, so a card only ever shrinks inside the slot
it was given, and zooming out does not pack the diagram tighter. A catalog
foreign-key edge attaches to the row of the column it leaves from and the row of
the column it points at, falling back to the card edge for a column the current
zoom step leaves out. Each catalog FK edge carries a cardinality mark — 1:1, 1:N
or N:M — counting how
many of its two ends have columns that cover a unique index (`IndexInfo.is_unique`)
or the primary key: both ends covered reads 1:1, exactly one reads 1:N, neither
reads N:M. The mark does not say which end is the 1. A composite foreign key
anchors on its first column pair. The mark reads only the metadata that has
arrived, and the diagram paints before that metadata does, so a mark can change
while a schema loads. Which mark each arrival state produces is pinned by the
`cardinality arrival states` table in
`src/components/schema/erdGraphModel.test.ts` rather than restated here. Data
compare remains a future promotion gate in the H4 smoke matrix.

Hand-drawn relationships ("virtual foreign keys", ADR 0055) are a stored model
rather than a drawing: `{ source, targets[], discriminator? }`, where several
targets express a polymorphic association and the discriminator names the source
column that decides which target a row points at. They persist per
`(connection, database)` in the SQLite `settings` row keyed
`erd_virtual_fk:<connection>:<database>`, so unlike node positions they survive
closing and reopening the ERD tab. They draw dashed with an open arrow head next
to the solid, filled-head catalog FKs, and both kinds are named in the canvas
legend, so the distinction never rests on colour alone. They meet the card edge
rather than a column row, and they carry no cardinality mark — that mark counts
ends pinned by the schema's own keys and unique indexes, and a hand-drawn link
declares none. Reconcile against the
current schema is a projection, not a delete, and it treats the three column
roles differently: a link whose source column is gone draws nothing, a target
whose column is gone drops out while the link's other targets keep drawing, and
a discriminator whose column is gone leaves every edge in place and only its
name out of them. The stored link survives all three, because a graph whose
metadata has not finished loading is indistinguishable from a dropped column.
Drawing a link from the canvas, editing or deleting one link, and undo/redo of
link edits are not included — the legend offers only a confirmed reset that
clears every link on that diagram (ADR 0056 (4) owns undo). A virtual FK is not a constraint: it stays
out of the selected-table dependency view, out of the cached schema diff, and out
of join completion, which ADR 0055 lists as explicit non-scope. Two windows open
on the same diagram do not converge on a reset: deleting the row leaves the other
window's next read with nothing to answer, so that window keeps drawing the links
it read earlier. A window opened after the reset finds no row and draws none.

### FK navigation

Current FK navigation is the DataGrid foreign-key cell/icon path that opens the
referenced row with filters. ERD selection, search, node drag, canvas zoom/pan,
fit, focus, and relationship highlighting are local diagram interactions, not FK
row navigation claims.

### CHECK constraints

CHECK constraint expressions are shown as raw SQL by design, matching
database-tool behavior.

### Grid filter operators

The RDBMS DataGrid structured filter builds its operator dropdown from the
connected dialect's `SqlDialectCapabilities`
(`src/lib/sql/sqlDialectProfile.ts`): an operator whose capability the dialect
does not declare is not offered.
`ILIKE` is wired that way (#2430) and rides on `capabilities.ilike`, which the
profile declares for PostgreSQL. An operator a dialect lacks is hidden, not
emulated — no `LOWER(col) LIKE LOWER(?)` rewrite is generated, because that
rewrite loses the column index and warning the user about that is a separate UI
decision. The backend keeps the same split: spellings shared across adapters
live in `FilterOperator::comparison_sql`, and a dialect-specific spelling lives
in that adapter (`pg_comparison_sql` in
`src-tauri/table-view-core/src/db/postgres/queries.rs`). An adapter handed an
operator it cannot spell drops that one condition, so the
browse returns a wider result set rather than an error. The document (MongoDB)
filter bar keeps its own operator set and is outside this list.

## Related

- [`docs/product/known-limitations.md`](known-limitations.md) — boundary index
- [`docs/product/current-support-snapshot.md`](current-support-snapshot.md) — current support snapshot
- [`docs/roadmap/follow-up-queue.md`](../roadmap/follow-up-queue.md) — open follow-up queue
- [`docs/ROADMAP.md`](../ROADMAP.md) — promotion order
