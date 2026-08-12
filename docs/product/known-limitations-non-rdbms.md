# Known Limitations — Non-RDBMS And Search Sources

Per-source boundary entries for key-value, document, and search engines, plus
the not-yet-modeled source candidates. Index and the remaining boundary areas
live in [`docs/product/known-limitations.md`](known-limitations.md).

## Per-Source Boundary Entries

### Redis

Redis connection/profile, backend KV primitives, key browser, value preview/edit
UI, selected-key bounded stream reader, bounded command editor vocabulary/key
suggestions, and a wired Runtime Happy Path smoke exist. Backend evidence covers
database/key scan, typed value reads, guarded string set, delete confirmation,
TTL expire/persist, bounded stream reads, selected read/write/TTL/stream command
dispatch through an allowlist with tabular result projection, and exact-key
`confirmKey` enforcement for single-key `DEL`/`PERSIST`. Frontend evidence
covers bounded string/hash/list/set/zset mutation controls with per-element
add/edit/delete verbs (HSET/HDEL, LPUSH/RPUSH/LSET/LREM, SADD/SREM, ZADD/ZREM;
element removals are classified destructive and routed through the shared Safe
Mode ConfirmDestructiveDialog, and removing the last element drops the key
itself because Redis GCs the now-empty collection), selected stream
start/end/count controls with refresh/loading/error/table states,
set/delete/expire/persist preview/confirm semantics, visible failure for
partial/unsupported mutation surfaces, command-name completion for the backend
allowlist with arity hints/snippets, and current-DB key suggestions filtered by
command key type with safe empty/error fallback. Runtime smoke proves the
representative connect/scan/preview/GET/guarded-write/TTL/delete path only.
Single-value keys whose content is JSON — a `string` holding a JSON
object/array, or a native `json`/ReJSON value — are additionally node-editable
inline in the value tree: editing, adding, or deleting a node re-serializes the
WHOLE value and overwrites the slot with one command (`SET key <json>` for a
string, `JSON.SET key $ <json>` for ReJSON, the latter newly admitted to the
bounded command allowlist bounded to the root `$` path for whole-value overwrite
only), reusing the same command preview plus Safe Mode gate as the manual
editors. It is last-writer-wins (no WATCH/CAS, the same semantics as the
existing string SET), the exact command is shown before it runs, and JSON
round-trip normalization (object key order/whitespace/number formatting such as
`1e3`→`1000` or `1.0`→`1`, plus >2^53 integer precision already lost at
read-time parse) and dot-path object keys containing `.`/`[`/`]` are known
limitations; scalars, non-JSON strings, and binary values stay read-only. The
same inline tree editor now also covers a JSON object/array **value of a hash
field (`HSET key field <json>`) or a list element (`LSET key index <json>`)**
when the collection is fully loaded and mutation-enabled, reusing the identical
command preview + Safe Mode gate and the same round-trip-normalization/dot-path
caveats; both `HSET` and `LSET` were already in the bounded command allowlist as
`Write`-effect verbs (from the #1415 inline row editor), so no new command
surface was added. Because `LSET` addresses a list position rather than a key, a
concurrent shift of the list between the read snapshot and the write can
overwrite a different element than intended (last-writer-wins, the same
positional ceiling as the existing inline `LSET` row edit, not a new risk); the
command preview surfaces the exact index before it runs, while hash fields are
keyed and stay stable. Stream keys — being append-only logs with no in-place
entry-field edit — get a bounded write surface in the stream reader panel
(#1683): `XADD key <id> field value …` appends a new entry (id defaults to
`*`/server-assigned; `Write` effect, so production still confirms via the Safe
Mode gate), while `XDEL key <id>` drops a whole entry and `XTRIM key MAXLEN
<count>` bounds the log length (both `Destructive`, routed through the shared
ConfirmDestructiveDialog danger tier), plus a per-row copy-to-form button that
prefills an entry's fields into the XADD add form with a fresh `*` id. Copy →
tweak → append → delete the old entry via `XDEL` is the "recreate" editing path;
copy never auto-deletes the original. Every operand is RESP-`.arg()`-encoded
individually (no string concatenation/interpolation) so a value containing
whitespace or verb-like text can never inject an extra command token, `XTRIM` is
bounded to the `MAXLEN` exact-count strategy allowlist (`MINID`/approximate
`~`/`LIMIT` rejected by the parser), and the previewed command string is exactly
what runs. The append-only/last-writer-wins semantics mean a
copied-then-re-added entry gets a new id rather than mutating the original, and
existing stream entry field values stay read-only in the value tree (edits go
through copy-to-form). Full Redis CLI/admin parity, language-core parser
ownership, broader Redis autocomplete, consumer-group stream UI, broader command
coverage, multi-key destructive commands, cluster, pub/sub, modules, and
consumer-group management remain out of scope. Static Redis fixtures are
seed/contract evidence and only become runtime evidence for paths wired into the
Redis smoke.

### Valkey

Valkey has a KV runtime slice: connection UI/runtime support, product label, KV
paradigm, Valkey backend adapter profile, database/key scan, typed value
preview, selected-key bounded stream reader, bounded Redis-compatible command
query dispatch, command completion for proven local-runtime rows with
current-DB/type-filtered key suggestions, the same bounded KvMutationPanel write
surface as Redis (#1075) — string SET/EXPIRE/exact-key PERSIST/exact-key DEL
plus hash/list/set/zset per-element add/edit/delete (HSET/HDEL,
LPUSH/RPUSH/LSET/LREM, SADD/SREM, ZADD/ZREM) — all routed through the shared
Safe Mode + ConfirmDestructiveDialog gate, and a wired Runtime Happy Path smoke
for connect/scan/preview/GET/HGETALL/XRANGE plus bounded SET/EXPIRE DML
summaries with readback/TTL verification and destructive/unsupported command
guards. Focused local testcontainer evidence covers direct string set, expire,
persist, exact-key delete, exact-key confirmation success for PERSIST/DEL, and
selected backend details below smoke. Command-editor completion still does not
suggest unpromoted command families such as list/set/sorted-set writes or full
Redis CLI coverage (a separate autocomplete surface from the KvMutationPanel
write controls). Valkey shares the same single-value JSON tree inline node
editing as Redis for `string` (JSON) and, where the ReJSON module is present,
`json` values — a whole-value overwrite via `SET`/`JSON.SET` behind the command
preview + Safe Mode gate, last-writer-wins, with the same JSON round-trip
normalization and dot-path key caveats. It also shares the hash field / list
element JSON value tree editing (`HSET`/`LSET` whole-value overwrite behind the
same gate), including the `LSET` positional-index ceiling on concurrent list
shifts, and the same append-only stream write surface (`XADD` append / `XDEL`
entry drop / `XTRIM MAXLEN` trim + copy-to-form, #1683) with per-operand
`.arg()` encoding, the `MAXLEN`-only XTRIM allowlist, and
append-only/last-writer-wins semantics. Full Redis compatibility, CLI/admin
parity, cluster/pubsub/modules, and consumer-group flows remain out of scope.
`e2e/fixtures/valkey/kv/seed.json` is the Valkey Runtime Happy Path seed, and
`e2e/fixtures/valkey.redis-compatibility.json` maps bounded Redis command
families and rejected Redis assumptions without widening Valkey beyond the
tested command slice.

### MongoDB

MongoDB support is limited to tested whitelisted document workflows.
Source-aware catalog metadata, workbench metadata panels, catalog-aware
collection/field/index-name autocomplete, row-edit MQL preview/discard, bulk
delete/update preview warnings, destructive collection/admin confirmations,
explicit read-only `runCommand` allowlist checks, and transaction-helper
unsupported gates are active for covered paths. Routine smoke proves one
representative connect/browse/edit/query/safety path; focused tests cover
broader catalog, autocomplete, bulk, index, validator, parser, cancellation, and
unsupported-helper behavior below smoke. Arbitrary JavaScript shell execution,
shell helpers, unsupported cursor helpers, multiple statements, cross-db shell
navigation, server-version feature promotion gates, native document-first result
panels, and full-support parity remain out of scope. Completion suggestions do
not widen runtime support. Transaction-style workflows fail clearly before IPC;
silent partial commit behavior is not allowed. Grid bulk commits are ordered but
non-transactional: a partial failure reports how many operations were applied,
removes exactly those from pending edits, and a retry runs only the remaining
operations (#1440).

### Elasticsearch / OpenSearch

Elasticsearch has live connection UI/runtime support for URL/auth/TLS root
probe, product/version/distribution detection, scoped redacted
auth/TLS/network/timeout/permission/server/shard failure surfacing, live catalog
reads for indexes, aliases, data streams, mappings, settings/analyzers,
templates, and field paths, bounded live `_search` execution with backend
validation for supported query/filter/aggs, pagination, `track_total_hits`,
bounded field sort, bounded `_source`, and the boolean `profile` flag request
clauses plus
hits/source/fields/highlights/sort/shards/aggs response parsing, a wired Runtime
Happy Path smoke for live connect/auth/TLS, catalog metadata, selected-index
detail, search/render, delete-plan, and error-surface evidence, and
delete-by-query that estimates matches through a safe `_search` preview then
executes a live `_delete_by_query` behind a Safe Mode confirmation (backend IPC
chokepoint), while rejecting wildcard and broad targets. OpenSearch has live
connection UI/runtime support for URL/auth/TLS root probe, OpenSearch
product/version/distribution detection, Elasticsearch endpoint rejection, scoped
redacted auth/TLS/network/timeout/permission/server/shard failure surfacing,
live catalog reads for indexes, aliases, data streams, mappings,
settings/analyzers, composable/legacy templates, field paths, bounded live
`_search` execution with shared backend validation/result rendering plus sample
documents, cancellation and scoped HTTP error handling, wired Runtime Happy Path
smoke for live connect/auth/TLS, catalog metadata, selected-index detail,
search/render, delete-plan, and error-surface evidence, and delete-by-query that
estimates matches through a safe `_search` preview then executes a live
`_delete_by_query` behind a Safe Mode confirmation (backend IPC chokepoint),
while rejecting wildcard and broad targets. Bounded Search DSL editor completion
uses product-scoped Elasticsearch/OpenSearch catalog/mapping context for
index/alias/data-stream/field/type/sort/source suggestions and shared snippets.
Initial sidebar load is index-catalog-first and fetches catalog shell for
Elasticsearch/OpenSearch only; selected-index
mappings/settings/analyzers/templates/field stats and sample documents remain
explicit lazy detail fetches, and search hits, explain/profile, or destructive
plans are not fetched by the shell. Search fixture files are contract evidence
and do not promote unwired Search paths to live runtime support. Search live
HTTP/admin promotion remains owned by the Search roadmap/milestone, not
non-RDBMS lazy-loading workbench hardening. Elasticsearch and OpenSearch closure
claims stay product-separated even when shared Search validator, renderer, and
smoke helpers provide common bounded behavior. The `_search` `profile` plan is
requestable from the search query tab's Explain button and rendered as a plan
tree (#2153); the `_explain` endpoint behind the same wording is not, and the
bounded validator still rejects the `explain` key. Full language-core
parser/completion ownership, `_explain` request workflow, broader admin
APIs (index/settings create/delete), global audit/admin/security dashboards,
unsupported DSL clauses beyond the validator, and product-specific live deltas
beyond the current Search
query/catalog/destructive-plan/delete-execution/completion slices are not
implemented.

### Wider source candidates

Cassandra/Scylla, DynamoDB, graph, vector, and stream sources have no active
`DatabaseType`, profile, runtime, parser/completion, fixture/live evidence, or
E2E smoke. They remain candidate-only until workflow value, profile target,
connection kind, language owner, catalog model, result envelope, safety policy,
fixture strategy, and smoke evidence are defined in a source-specific promotion
PR. DynamoDB's locked candidate contract is `cloud-document` + `cloud-api`,
native API-first with `partiql` deferred, table/keySchema/GSI/LSI catalog,
`document`/`tabular` result envelopes, access-pattern/cost/IAM/credential
guardrails, future-only DynamoDB Local/emulator or bounded mock evidence, and a
required threat-model handoff before auth/KDF/ACL/secrets/provider decisions.
Vector's locked candidate contract is `vector` + `server`, cloud providers
behind a separate `cloud-api` profile decision, future `vector-query` or
provider filter DSL, collection/vectorSchema/payloadIndex catalog,
`vectorNeighbors` result envelope, topK/filter/write/delete guardrails,
future-only embedded/mock or container fixture evidence, and a required
threat-model handoff before cloud credential/provider decisions.

## Related

- [`docs/product/known-limitations.md`](known-limitations.md) — boundary index
- [`docs/product/current-support-snapshot.md`](current-support-snapshot.md) — current support snapshot
- [`docs/roadmap/follow-up-queue.md`](../roadmap/follow-up-queue.md) — open follow-up queue
- [`docs/ROADMAP.md`](../ROADMAP.md) — promotion order
