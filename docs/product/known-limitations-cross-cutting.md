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
masquerading as production. Destructive classification reuses the native
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
actual live Search admin execution, and a general security dashboard are not
implemented. PostgreSQL and MySQL/MariaDB connections honor
`tls_enabled`/`trustServerCertificate` when set (encryption required with full
certificate verification, or verification skipped when the certificate is
trusted) and reject contradictory combinations instead of silently downgrading
to plaintext. Per ADR 0053 (#1063), the connection form now exposes an sslmode
dropdown (`disable`/`prefer`/`require`/`verify-full`) for
PostgreSQL/MySQL/MariaDB — a view over the stored `(tls_enabled,
trust_server_certificate)` pair, unset staying the opportunistic driver `prefer`
default with a hint; the on/off TLS engines
(MongoDB/Redis/Valkey/Elasticsearch/OpenSearch) expose an explicit opt-in "trust
server certificate" (skip-verify) checkbox, gated on TLS being on and carrying
an in-form warning; SQL Server keeps its `trust=true` default with an added
skip-verify warning; and URL paste honors `sslmode`/`ssl-mode`/`tls` parameters,
surfacing a notice for values it cannot map (e.g. `verify-ca`) rather than
dropping them silently. Switching the dbType never carries a skip-verify choice
onto the next engine. Advanced depth — CA files, client certificates,
`verify-ca`, 1-stage-engine sslmode expansion, and TOFU certificate pinning —
remains a follow-up (#1649).

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
rejection; it does not widen raw SQL DDL, ALTER rebuilds,
index/constraint/table-removal DDL, nested JSON edit, sqlite-cli execution, or
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
Search observability/profile workflows, or product-specific destructive deltas.
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
`e2e/smoke/**`, reset-to-default audits, ERD scenarios, additional file
analytics scenarios beyond the wired `duckdb-file-analytics` spec, broader
Search scenarios, and macOS/Windows runtime smoke are future promotion gates
unless the CI script wires them.

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
aliases. The ERD is opened as a database-level diagram tab from the schema-tree
header action (gated on the engine's `intelligence.erd` capability), not from a
per-table sub-tab. Data compare and dense-view smoke remain future promotion
gates in the H4 smoke matrix.

### FK navigation

Current FK navigation is the DataGrid foreign-key cell/icon path that opens the
referenced row with filters. ERD selection, search, zoom, fit, focus, and
relationship highlighting are local diagram interactions, not FK row navigation
claims.

### CHECK constraints

CHECK constraint expressions are shown as raw SQL by design, matching
database-tool behavior.

## Related

- [`docs/product/known-limitations.md`](known-limitations.md) — boundary index
- [`docs/product/current-support-snapshot.md`](current-support-snapshot.md) — current support snapshot
- [`docs/roadmap/follow-up-queue.md`](../roadmap/follow-up-queue.md) — open follow-up queue
- [`docs/ROADMAP.md`](../ROADMAP.md) — promotion order
