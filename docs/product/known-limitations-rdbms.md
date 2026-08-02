# Known Limitations — RDBMS Sources

Per-source boundary entries for the relational engines. Index and the
remaining boundary areas live in
[`docs/product/known-limitations.md`](known-limitations.md).

## Per-Source Boundary Entries

### PostgreSQL query/workbench parity

PostgreSQL is the strongest active RDBMS lane. Current routine desktop smoke
covers connect, browse seeded data, edit/query verification, Explain plan
inspection from the query editor with an Explain history source label, seeded
`pgcrypto`/`fuzzystrmatch` installed-extension completion gating, Safe Mode
info/warn/destructive confirmation, raw DDL preview/confirm, grid-edit
preview/confirm paths, cancellation UI/history/retry behavior, and bounded
Structure table-plus-index DDL preview/execute/history/schema-refresh behavior.
The cancellation claim is limited to query toolbar/API cancellation, cancelled
history state, stale-grid clearing, and retry. The Structure DDL claim is
limited to table creation plus index creation. PostgreSQL also supports CSV
row-level import (#1640): the schema-tree "Import CSV…" entry maps CSV columns
to a target table and commits one single-row INSERT per row through the shared
`execute_query_batch` command in a single all-or-nothing transaction, with a
tri-state empty-field toggle (SQL NULL or `''`) and a pre-commit confirmation
naming the target/row count/rollback policy; it is PostgreSQL-only (the
statement builder emits PostgreSQL-dialect SQL and refuses other engines with
`Unsupported`), and does not add streaming/COPY bulk load or type inference.
Full PostgreSQL dialect/admin parity is not claimed: PL/pgSQL body authoring,
broad MERGE variants, arbitrary nested/function-expression semantics, arbitrary
extension semantics, catalog-backed enumeration of every extension symbol,
DB-level backup/restore/import/export, role/user/permission UI, extension
management UI, session-management/kill parity, broader structured DDL flows,
ERD, and admin scenarios remain future promotion gates. The server activity and
slow-query (profiler) panels are capability-gated auto-polling dashboards with a
session-local, non-persistent count trend (no activity or slow-query history is
written to disk or DB per ADR 0036/0042), but full profiler/activity admin
parity is still out of scope. Explain is plan inspection only, not
profiler/activity parity. Read-only cross-table value search (#1525) is a
PostgreSQL-only lane: it scans the selected schemas' text-family columns
(`text`/`character varying`/`character` plus the `citext` extension type) with a
bound-parameter ILIKE under a per-table `LIMIT` plus a global match cap and
cooperative cancellation, and every other RDBMS adapter returns Unsupported
until a per-engine follow-up lane promotes it.

### MySQL / MariaDB capabilities

MySQL and MariaDB active behavior is limited to routine desktop smoke baselines
for connect, seeded table browse, catalog/workbench metadata browse, SELECT,
narrow seeded `CALL proc(scalar)` result rendering, DML batch, row edit,
cancellation/retry, history/source labels, and tabular result rendering. MariaDB
has its own MariaDB-engine smoke evidence rather than inheriting the MySQL
claim. MySQL row-edit generated SQL has unit/hook coverage for backtick
identifier quoting, primary-key row projection, JSON/scalar/null coercion, and
preview/commit/discard consistency; MariaDB now has hook coverage for the same
MySQL-family quoted key-projected preview/discard/commit path under MariaDB
connection identity. MySQL-family catalog/workbench metadata covers tables,
views, columns, indexes, constraints/FKs, and routine metadata browse;
CHECK/constraint hints are version-gated. MySQL-family completion can suggest
current-context schemas, tables/views, columns, and routines through the
Rust/WASM catalog path, including backtick identifier contexts. MariaDB
completion keeps distinct `mariadb` identity and only hides the keyword-level
`RETURNING` suggestion when known server version context is below `10.0.5`.
These are editor suggestions only; they do not widen runtime support for stored
routine bodies or scripting. Version-aware capability gates are typed and
tested. The MySQL-family adapter detects live server version context and gates
CHECK/constraint catalog metadata at MySQL `>= 8.0.16` / MariaDB `>= 10.2.1`;
older or unknown versions return empty CHECK hints. MySQL-family parser/Safe
Mode covers `LIMIT offset,count`, `ON DUPLICATE KEY UPDATE`, and narrow `CALL
proc(scalar)` with literal, `DEFAULT`, `NULL`, boolean, or user-variable
arguments; routine execution beyond the seeded narrow CALL probe, broad CALL
expressions, stored routine/event bodies, control-flow scripting, `DELIMITER`,
and `LOAD DATA` are explicit unsupported editor/backend boundaries. A read-only
users/roles listing from `mysql.user` (`User`/`Host` plus the privilege flags;
the `authentication_string`/`Password` credential columns are never selected) is
available on both MySQL and MariaDB (#1077 Stage 2). It reads `account_locked`,
so it requires MySQL 5.7.8+ / MariaDB 10.4.2+ and fails loud on older builds
rather than mislabelling a locked account as loginable; `can_login` also
accounts for the `mysql_no_login` plugin, and `max_user_connections` is
normalised onto the PG `rolconnlimit` wire sentinel (MySQL `0` = unlimited
becomes `-1`, a negative MariaDB cap becomes `0`). MariaDB 10.4+ roles live in
the same view with an empty `Host` and are listed under their bare name as
non-loginable. `can_create_db` over-reports: it renders `mysql.user.Create_priv`,
MySQL's global `CREATE` privilege, in the PG `rolcreatedb` ("may create
databases") wire slot, but global `CREATE` also covers `CREATE TABLE`/`CREATE
INDEX`, so an account holding it for table DDL alone still shows as a database
creator — and the flag does not consult `read_only`/`super_read_only`, which
blocks `CREATE DATABASE` for a non-`SUPER` account regardless of the grant. Read
it as "holds global `CREATE`". Role membership (`mysql.role_edges`), MySQL 8
dynamic privileges such as `SYSTEM_USER`/`ROLE_ADMIN` (a holder is reported as
non-superuser because only `Super_priv` is read), password expiry, per-schema
grants, and user/role write management (create/alter/drop) remain unsupported.

### MySQL / MariaDB export and DDL parity

MySQL and MariaDB support bounded structured table/index/constraint DDL and
generic grid exports. MariaDB DDL export keeps a MariaDB header while emitting
MySQL-family backtick SQL for table/index/FK definitions. Structure trigger
metadata can be browsed, but structured trigger create/drop controls stay hidden
for MySQL-family sources because trigger body authoring is raw-SQL-only in the
current model. MySQL/MariaDB schema dumps are now vendor-restorable:
`export_schema_dump` emits backtick-quoted identifiers and MySQL-family INSERT
string escaping (backslash-aware, no PostgreSQL `::jsonb` cast) so a DDL+DML
dump restores into a default-`sql_mode` MySQL/MariaDB server, proven by a docker
round-trip that dumps a table, empties it, restores the emitted SQL, and matches
the source rows (#1641, #1077 Stage 1). Binary/BLOB columns now dump as an
unquoted MySQL binary literal (`X'<hex>'`), so a varbinary/BLOB round-trip is
byte-faithful — proven by the same docker round-trip seeding a varbinary column
with a control-byte value (#1677). Broader procedure-management workbench parity
and DB-level backup/restore/import/export remain unclaimed.

### MariaDB

MariaDB currently reuses the MySQL-family runtime adapter implementation,
parser/Safe Mode path, CodeMirror dialect, capability/conformance family, and
`mysql-client` completion family while keeping a distinct MariaDB
identity/profile and engine smoke baseline. Catalog/workbench evidence now
covers MariaDB tables, views, columns, indexes, constraints/FKs, and routine
metadata browse; CHECK hints still require MariaDB `>= 10.2.1` version context.
MariaDB row edit and bounded table/index/constraint DDL have MariaDB-specific
test/docs evidence for the intentional MySQL-family path, and the routine
MariaDB smoke now proves a bounded Structure table/index/FK DDL
preview/execute/catalog-readback path. The MariaDB `RETURNING` delta is
profile/completion plus structural parser/Safe Mode evidence only; autocomplete
suppresses the keyword-level suggestion for known MariaDB versions below
`10.0.5`, while parser/Safe Mode still keeps supported DML shapes on the normal
INSERT info, bounded UPDATE/DELETE warn, and WHERE-less UPDATE/DELETE danger
tiers. Focused `mariadb:11` integration evidence runs `SELECT VERSION()` before
`DELETE ... RETURNING`; the current server accepts the statement and deletes the
row, but the shared adapter returns a DML envelope with no columns, no returned
rows, and no affected-row count. Runtime acceptance remains server-resolved and
is not a client-side version-gated returned-row support claim. MySQL-only
closure evidence does not automatically promote MariaDB behavior unless MariaDB
has matching engine, version-context, test, and docs evidence.

### MariaDB fixture evidence

MariaDB has a wired Runtime Happy Path seed/spec for the
connect/browse/query/edit/cancel baseline, narrow seeded CALL probe, and
catalog/workbench metadata probe. Broader MariaDB-only syntax, routine
default/body behavior beyond that probe, procedure management/body authoring,
admin/import/export, completion-runtime evidence, and full vendor-workbench
parity remain separate promotion gates.

### SQLite

SQLite user-DBMS files support absolute-path connection, create-new-file,
browsing, read queries, writable-file DML, transactional DML batch/dry-run,
cancellation, read-only mode, primary-key-scoped row edits, and bounded
structured table creation for writable files. The user DBMS file is explicitly
separated from internal app SQLite state. GitHub Runtime Happy Path now wires a
SQLite desktop smoke for file create/open, table browse, read query, writable
DML, row edit, structured table creation with schema refresh proof, read-only
write rejection, and internal app-state DB rejection. Raw SQL DDL execution
remains rejected by the query adapter, and broader structured DDL parity is not
implemented: unsupported `ALTER TABLE` rebuilds, table/index removal or rename,
index creation, standalone constraint changes, nested JSON edits, sqlite-cli
execution, and JSON1/FTS/RTREE/loadable-extension semantics remain separate
gates. Read-only file connections reject writes and table creation.

### DuckDB

DuckDB is currently modeled as a file-backed RDBMS profile, not a separate
file-SQL paradigm. Local `.duckdb` files support connection, catalog/table
reads, and statement-level raw SQL through the RDBMS path. GitHub Runtime Happy
Path now wires separate DuckDB desktop smokes for `.duckdb` open, catalog/table
browse, raw SELECT tabular result/history evidence, writable DML readback, and
read-only write rejection, plus registered deterministic CSV source -> global
editor SELECT -> result grid -> `FILE` history/source evidence -> no absolute
local path in visible UI. Structured grid row edits (INSERT/UPDATE/DELETE) are
now exposed on writable connections through the transactional
`execute_sql_batch` path (ADR 0051 Stage 1, #1070). Native structural DDL is now
exposed on writable connections (ADR 0051 Stage 2, #1070): the schema-tree
Create/Rename/Drop table actions and the Structure column/index editors run
native DuckDB `ALTER TABLE`/`CREATE|DROP TABLE|INDEX` — table
create/drop/rename, column add/drop/type, and index create/drop. Column comments
are emitted as native `COMMENT ON COLUMN` from both table create and column add.
DuckDB indexes are ART-only and its `CREATE INDEX` has no `USING <method>`
clause, so the index dialog's non-default methods (`hash`/`gin`/`gist`/`brin`)
are rejected with a validation error rather than silently ignored. Constraint
add/drop (Stage 2b, which needs a rebuild-swap because DuckDB `ALTER TABLE`
cannot add/drop constraints), identity/auto-increment columns (Stage 2b, which
needs a `CREATE SEQUENCE` + `DEFAULT nextval(...)` pair), and
dry-run/multi-statement transactions (Stage 3) are not yet implemented; the
constraint controls (Constraints editor add/drop, the Create Table dialog's
FK/CHECK/UNIQUE tab and per-column inline FK/CHECK, the Add Column dialog's
CHECK input) and the Identity checkbox stay hidden (`ddl.alterConstraint` /
`ddl.identityColumn` capabilities false) rather than click-then-error, and the
adapter rejects both with `Unsupported` if reached directly. Read-only files
reject writes; extension install/load statements and helper functions, `COPY`
import/export, `ATTACH`/`DETACH`, sensitive external-file capability settings,
cloud/object-store access, raw external-file functions, and string replacement
scans are blocked, and extension autoload is disabled. DuckDB completion is
editor assistance for vocabulary, cached `.duckdb` schema objects, and
active-session registered source aliases/columns after source metadata is
loaded; it does not widen those runtime blocklists. The support claim is limited
to `.duckdb` smoke plus registered-source
preview/query/history/privacy/global-editor/global-query-backend evidence and
the dedicated deterministic CSV file analytics smoke; no extension install/load,
admin, or automatic import/export parity is implied. Registered local
CSV/Parquet/JSON/NDJSON analytics has active-session source registration,
preview, source-scoped SELECT dialog evidence, global query editor SELECT
execution through the normal result surface/backend path against registered
aliases, and distinct `FILE` history labeling for successful dialog and
global-editor source queries, while broader automatic import/export workflows
remain future promotion gates in the H3 smoke matrix.

### DuckDB file privacy / export

File analytics source paths stay in active-session adapter state and clear on
connect/refresh/disconnect. Public source metadata, preview, and query payloads
expose id, alias, file name, kind, size, columns, and preview SQL only; backend
errors redact local paths. Export behavior is the existing explicit save-dialog
grid export for current rows, not an automatic export of a registered local file
source.

### MSSQL

MSSQL runtime support now covers SQL-auth/TDS connection, catalog
browse/schema/indexes/constraints/relationships, query, multi-statement
execution, cancellation, tabular result rendering, and editRows through the
frontend SQL batch path with primary-key projection. #907 wires representative
Runtime Happy Path smoke for connect, seeded catalog browse, SELECT/DML,
destructive Safe Mode confirmation, cancellation, and grid edit. The `mssql`
profile/dialect identity, SQL Server labels/defaults, URL parsing, and seed/spec
inventory remain source-specific. `switchDatabase` stays disabled under the
current connection contract. Bounded structured table/index/constraint DDL is
now wired through the shared StructurePanel path (#1071). SQL Server schema
dumps restore into SQL Server for text/numeric/boolean/JSON data:
`export_schema_dump` emits `[bracket]`-quoted identifiers and Unicode-safe T-SQL
INSERT string escaping (`N'...'` literals with single-quote doubling, no
backslash escape, BIT `1`/`0` booleans, no PostgreSQL `::jsonb` cast), proven by
a docker round-trip that dumps a table (including non-ASCII rows), empties it,
restores the emitted SQL, and matches the source rows (#1642, #1077 Stage 1).
Binary/varbinary columns are now covered: they dump as an unquoted T-SQL binary
literal (`0x<hex>`) so a byte-faithful round-trip survives restore, proven by
the same docker round-trip seeding a varbinary column with a control-byte value
(#1677). Admin/security/jobs and user/role write management (create/alter/drop),
DB-level import/backup/restore, profiler/activity dashboards, full T-SQL
semantic parity, full workbench parity, and SQLCMD/meta-command/procedure-body
scripting remain unsupported; a read-only users/roles listing from
`sys.server_principals` (login/role name + capability flags, never
`password_hash`) is available (#1077 Stage 2). That listing requires `VIEW ANY
DEFINITION`: `sys.server_principals` is a metadata-visibility-filtered catalog
view, not a DMV, so an unprivileged login would receive a silently truncated
principal list — the adapter probes the permission with `HAS_PERMS_BY_NAME` and
fails loud as `CapabilityNotEnabled` instead. The probe answers for the SERVER
scope, so one truncation survives it: a principal that carries `DENY VIEW
DEFINITION ON LOGIN::<principal>` against the connected login is silently absent
from the rows even though the probe returned 1 (measured on SQL Server 2022
16.0.4265.3 — a login holding `VIEW ANY DEFINITION` plus one such DENY sees the
granting probe succeed and the denied principal missing, with no error).
Detecting it would need per-principal permission reads that are themselves
metadata-filtered, so the listing is complete only for a login with no
per-principal DENY against it; use a `sysadmin`-level login for a full account
audit. `is_superuser`/`can_create_db`/`can_create_role` reflect
`sysadmin`/`dbcreator`/`securityadmin` membership, each resolved from both
`IS_SRVROLEMEMBER` and a recursive `sys.server_role_members` walk, because
`IS_SRVROLEMEMBER` alone answers NULL for a certificate-/asymmetric-key-mapped
principal and would report a real member as unprivileged. `can_login` is limited
to principal types that can authenticate (SQL login, Windows login, Windows
group, Microsoft Entra login `'E'`, Entra group `'X'`), so a server role or a
certificate-/key-mapped principal is listed as non-loginable. Row selection
itself applies no principal-type filter — an earlier `type IN
('S','U','G','R','C','K')` whitelist dropped every Entra principal with no row
and no error, which on an Entra-authenticated server is the whole account
population, so the listing now returns every non-`##MS_*` principal whatever its
type. Internal `##MS_*` principals are filtered out, and database-scoped
users/permissions, per-login connection caps, password expiry, and server-role
membership arrays are not exposed. Parser/completion support is bounded editor
assistance and unsupported-boundary recognition only. Named instances, Windows
authentication, Azure AD/authSource modes, backup/restore, and broader SQL
Server operational workflows remain out of scope until a source-specific
promotion issue proves them.

### Oracle

Oracle supports service-name lifecycle plus a bounded #905/#906
catalog/query/cancel/tabular/edit-row runtime slice. #907 wires representative
Runtime Happy Path smoke for service-name connect, seeded catalog/routine
browse, SELECT/DML, destructive Safe Mode confirmation, cancellation, and grid
edit. The `oracle` profile/dialect identity, Oracle labels/service-name
defaults, URL parsing, and seed/spec inventory remain source-specific. Supported
runtime is limited to catalog metadata, SELECT/DML batch execution, cooperative
cancellation, tabular table-data query, key-projected editRows through the
frontend SQL batch path, tested SELECT/DML/DDL Safe Mode classification, and
bounded editor assistance. Bounded structured table/index/constraint DDL is now
wired through the shared StructurePanel path (#1072). Oracle schema dumps
restore into Oracle for text/numeric/binary data: `export_schema_dump` emits
ANSI `"double-quote"`-quoted identifiers and Oracle INSERT value escaping
(single-quote doubling, `HEXTORAW('…')` binary literals, `1`/`0` NUMBER
booleans, no PostgreSQL `::jsonb` cast) over the `stream_table_rows` server-side
cursor, proven by a docker round-trip that dumps a table (including non-ASCII
and RAW binary rows), empties it, restores the emitted SQL, and matches the
source rows (#1674, #1077 Stage 1). DATE/TIMESTAMP columns dump as quoted
strings whose restore depends on the session `NLS_DATE_FORMAT`, so date/time
round-trip fidelity is not claimed. The adapter still blocks switch database,
raw DDL/admin, PL/SQL body/package authoring, and trigger DDL beyond the bounded
catalog smoke path. #1065 adds SID connections (driver-native
`Config::with_sid`) and Oracle wallet mTLS (`Config::with_wallet`, `ewallet.pem`
only) for Oracle Cloud Autonomous DB, guarded by a host/service/SID character
whitelist at the `connect_config` trust boundary (the driver interpolates these
into a TNS descriptor with zero escaping) and with the wallet path/password
following the existing path-reference + keyring-envelope + IPC-masking +
export-strip contracts; live SID round-trip and wallet-mTLS TCPS verification
remain a docker/ADB integration residual (config assembly, guards, and redaction
are unit-covered). Free-form TNS descriptors and tnsnames.ora aliases,
wallet-less 1-way TLS (TCPS + CA cert), `cwallet.sso`/`ewallet.p12` wallet
formats, advanced/external auth, users/roles/grants/session/storage/admin paths,
DB-level import/backup-restore, profiler/activity, full parser/completion
promotion, and full Oracle semantic behavior remain out of scope until
source-specific promotion issues prove them.

## Related

- [`docs/product/known-limitations.md`](known-limitations.md) — boundary index
- [`docs/product/current-support-snapshot.md`](current-support-snapshot.md) — current support snapshot
- [`docs/roadmap/follow-up-queue.md`](../roadmap/follow-up-queue.md) — open follow-up queue
- [`docs/ROADMAP.md`](../ROADMAP.md) — promotion order
