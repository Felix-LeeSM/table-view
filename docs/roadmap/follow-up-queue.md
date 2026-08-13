# Open Follow-Up Queue

Open risks are no longer tracked in a standalone active risk register. Route each
item to the document that owns the decision:

- Product-visible support boundaries and known limitations:
  [`docs/product/known-limitations.md`](../product/known-limitations.md) for the
  index and the UI/results/auto-update entries; per-source entries go to its
  `known-limitations-{rdbms,non-rdbms,cross-cutting}.md` children.
- Developer-facing verification gaps:
  [`docs/contributor-guide/testing-and-quality.md`](../contributor-guide/testing-and-quality.md).
- Historical risk IDs and prior register snapshots:
  [`docs/archives/risks/active-risk-register-2026-05-27.md`](../archives/risks/active-risk-register-2026-05-27.md).

## Near-term follow-up groups:

### RDBMS parity

**Follow-up**: Keep PostgreSQL as the strongest query/workbench parity lane
until a focused implementation slice promotes the next PostgreSQL gap with
matching tests and smoke routing. Keep MySQL/MariaDB runtime smoke baselines
narrow to connect/browse/query/edit/cancel/history/result-envelope behavior; add
broader MySQL/MariaDB operation-level UI/runtime consumers only with matching
evidence. Keep SQLite file-DBMS work scoped to writable-file DML, PK row edits,
the DDL SQLite runs natively, raw SQL DDL rejection, and the current
deterministic file smoke baseline. SQLite adapter 가 전면 차단하던 DDL 중 **SQLite 가
네이티브로 지원하는 축**의 개방은 #1804 로 끝났다 — 어댑터 실행은 #2103, capability 선언과 UI
게이트는 그 후속 PR 이다. 12-step ALTER rebuild 는 미도입 결정이고 (2026-07-25 오너 grill),
직접 못 하는 변경 (컬럼 타입·NOT NULL·DEFAULT, 독립 제약 선언·추가·삭제) 중
컬럼 쪽은 Structure UI 가 per-row Edit 을 disabled 로 남기고 사유를 툴팁으로 띄우고, 제약 쪽은
SQLite 에 Constraints 탭 자체가 없어 끌 컨트롤이 없다. 실행 후 에러 매핑은 네이티브로 지원되는
`ADD COLUMN`/`DROP COLUMN` 의 조건부 실패에만 적용된다. raw SQL DDL 거부와 extension
semantics 는 그대로 자체 구현 근거를 요구한다. Keep DuckDB split between
`.duckdb` file smoke and file analytics smoke; file analytics does not promote
COPY/ATTACH/DETACH, extension install/load, raw external-file SQL functions,
automatic import/export workflow, structured DDL/write UI, or admin parity.

### Query language widening

**Follow-up**: Widen SQL/Mongo client semantic support by tested slices: future
MySQL/MariaDB routine-expression support only after the explicit unsupported
scripting boundary is re-scoped, SQLite extension/capability semantics,
server-version/capability gates, Mongo version/deployment gates, and
extension-aware completion packs. DuckDB extension install/load and
external-file capability settings are currently blocked by adapter gates; future
DuckDB extension support needs detected capability evidence before
completion/runtime claims widen. PostgreSQL completion packs must consume
installed extension inventory before enabling curated extension-specific
candidates.

### Query/result boundary

**Follow-up**: Keep typed envelopes as the UI-facing boundary. Future hardening
can make backend RDBMS IPC emit native `tabular` envelopes instead of
normalizing legacy `QueryResult` at the Tauri wrapper.

### ERD/schema graph

**Follow-up**: 현재 schemaStore cache owner 범위는
schemas/tables/views/functions/postgresExtensions/tableColumnsCache/tableIndexesCache/tableConstraintsCache/triggers
이다. Production ERD/`SchemaGraph` input 은 schema/table/column cache 와
cached/fetched explicit index/constraint metadata 를 함께 쓰며, column-level FK info
는 synthetic fallback 으로 남아 있다. FK navigation 은 현재 DataGrid cell/icon path 이며 ERD
interaction claim 이 아니다. Read-only dependency view 는 selected table 의
incoming/outgoing FK, index, constraint, CHECK expression, metadata diagnostics
를 보여준다. Migration impact summaries and read-only cached schema diff reuse the
shared `SchemaGraph`/catalog input path. Dense ERD desktop/narrow screenshot
smoke is wired; follow-up 은 data compare (#1796) 다 — 2026-07-25 오너 grill 이 읽기전용
row diff 로 lock 했다 (쓰기/동기화 SQL 생성 없음, row cap 내에서만 비교하고 초과 시 잘림 배너). Duplicate
catalog parsing 금지.

**Follow-up (cardinality 표기, #2151 이 남긴 상한)**: 표기는 고정된 끝의 개수만
세므로 어느 쪽이 `1` 인지 배지가 말하지 않는다. composite FK 는 관계 하나가 엣지
하나를 그리는 동안 첫 컬럼 쌍에만 앵커한다. 표현식 index 와 partial unique index 는
컬럼 목록이 서로 다른 폭으로 들어오지만 마크에 미치는 해악은 같다 — 둘 다 스키마가
보장하지 않는 uniqueness 를 주장한다. partial unique index 는 술어를 실을 자리가
`IndexInfo` 에 없어 `WHERE` 절이 사라진 채 컬럼 폭 그대로 `is_unique: true` 로
들어온다. 표현식 index 는 어댑터가 표현식 슬롯을 버려 컬럼 목록이 좁아지는데,
`erdEndIsUnique` 가 부분집합 판정이라 좁아진 목록이 오히려 더 많은 끝을 고정한다.
키가 전부 표현식이라 컬럼 목록이 비면 그 index 는 unique 집합에 아예 안 들어온다.
그리고 같은 FK 에 cardinality 구현이 둘이다 — ERD 는
uniqueness 로(`src/components/schema/erdGraphModel.ts`), mermaid export 는
nullability 로(`src/lib/schemaGraphTextExport.ts`) 판정한다. 어느 쪽을 정본으로
삼을지는 설계 결정이라 별도 티켓 몫이다. 승격은 사용자가 표기를 오해했다는 신호가
올 때다.

### Redis/Valkey

**Follow-up**: Redis first slice is backend KV primitives, key browser/value
preview/edit UI, selected-key bounded stream reader, bounded command query
runtime/completion, current-DB/type-filtered key suggestions, and representative
connect/scan/preview/GET/guarded-write/TTL/delete smoke. Valkey first slice is
connection/key scan/value preview plus selected-key bounded stream reader,
bounded command query, the shared Redis/Valkey string plus hash/list/set/zset
KvMutationPanel write controls (#1075), Runtime Happy Path smoke, focused local
testcontainer evidence, and proven-row command completion. 2026-07-25 오너 grill 이
잔여 축 전부 지원을 결정하고 5건으로 분해했다: parser/completion vocabulary 를 Rust/WASM 으로 **먼저**
이전하고 (#1805 — 지금 20개일 때 옮기는 게 ~200개로 불린 뒤 옮기는 것보다 싸다), 그 뒤 allowlist 대확장 (#1806
— 읽기 진단·원자 연산·키 관리·multi-key·consumer-group), scripting/admin 쓰기 (#1807 —
`EVAL_RO`/`EVALSHA_RO`/`FCALL_RO` 는 읽기 tier, `EVAL`/`FCALL`/`SCRIPT
LOAD`/`FUNCTION LOAD`/`CONFIG SET` 은 destructive tier), pub/sub (#1808), cluster
(#1809). consumer-group 전용 UI (#1806 은 명령 allowlist 만 덮고 UI 는 범위 밖이다), full
CLI/admin parity, modules, full Redis compatibility 는 소유 이슈 없이 계약·근거 미정으로 남는다.

### MongoDB

**Follow-up**: Keep support to tested whitelisted document workflows. Future
widening needs version/deployment gates and safe native document-first panels;
arbitrary JavaScript/shell behavior remains unsupported unless a new decision
changes the policy.

### Search

**Follow-up**: Keep actual Elasticsearch/OpenSearch index/settings admin
execution deferred. Elasticsearch/OpenSearch live connection/catalog/query,
backend-bounded Search DSL validation, delete-by-query safety planning, live
`_delete_by_query` execution behind the Safe Mode confirm gate (#1076), bounded
TypeScript Search DSL editor assistance, and representative Runtime Happy Path
smoke are active; the smoke covers connect/auth/TLS contract, selected metadata,
bounded render, delete-plan preview, live delete execution, and error surface.
Promote broader live HTTP only after index/settings admin execution policy,
broader observability workflows, full language-core parser/completion
ownership, and product-specific delta contracts are explicit.

### MSSQL/Oracle

**Follow-up**: Keep MSSQL at bounded catalog/query/cancel/tabular/edit-row
enterprise RDBMS support with source-specific SQL-auth/TDS/encryption contract
and #907 representative smoke, and keep Oracle at bounded service-name
catalog/query/cancel/tabular/edit-row runtime support with bounded Safe
Mode/editor assistance and #907 representative smoke. Future promotion must add
matching DDL, full parser/completion, docs, and smoke evidence without hiding
SQL Server and Oracle auth/dialect differences behind a shared abstraction. Keep
full admin parity, import/export, profiler/activity, role/user/permission UI,
broad scripting, MSSQL admin/full T-SQL semantics, and the Oracle axes still
unproven — advanced auth, raw DDL/admin, full PL/SQL semantics, and the
tnsnames.ora alias resolver — out of scope until separately proven. The Oracle
axes that have since been proven are not on this list: SID and the wallet
(#1065), structured DDL (#1072), and TNS descriptor plus 1-way TCPS (#2154) —
see the *Connection TLS/SSH/Oracle* entry below.

### Wider source candidates

**Follow-up**: Keep Cassandra/Scylla, DynamoDB, graph, vector, and stream as
candidate-only. Do not add active `DatabaseType`, profile, runtime,
parser/completion, fixture/live, or E2E support claims until workflow value and
the full adding-data-source contract are locked.

### Connection TLS/SSH/Oracle

**Follow-up**: 2026-07-17 오너 grill 이 연결 보안 lane 1차 범위를 lock 했다 (ADR 0053,
`docs/explorations/{connection-tls-parity,ssh-tunnel,oracle-wallet-tns}-threat-model-2026-07-17.md`
결정 섹션). 1차 = core 2필드 TLS 어휘 통일 + pg/mysql sslmode enum + warning-first 기본값
(#1063), SSH 터널 잔여 축 (#1064, ADR 0052 위), Oracle A1 SID+Service (#1065).
Advanced TLS depth-step — CA 파일·클라이언트 인증서·1단 엔진 sslmode 확장·`verify-ca`·TOFU 인증서
핀 검토 — 는 #1649 로 후속 승격한다. 그중 `verify-ca` 어휘, `caCertPath` 필드와 드라이버 배선,
1단 엔진 sslmode 확장은 #1649 1차 (ADR 0058) 로 실렸다. 남은 것은 클라이언트 인증서, TOFU 인증서
핀, 폼 안의 CA 파일 피커, 1단 엔진 5종(MongoDB·Redis/Valkey·Elasticsearch/OpenSearch)의 사설
트러스트 앵커다 — `docs/product/known-limitations-cross-cutting.md` 의 TLS 문단과 같은 목록이다.
Oracle 1-way TLS (TCPS + CA cert) 는 #1650 으로 열렸고, TNS descriptor (#2102) 와 함께
#2154 가 `connect_config` 한 축에 실었다 — `verify-ca` 의 CA 파일이 신뢰 앵커이고,
wallet mTLS 와는 상호 배타다. 남은 것은 tnsnames.ora 별칭을 파일에서 펴 주는 resolver 와,
드라이버가 표현하지 못하는 skip-verify(`require`) 자세다.

### CLI DSN parsing

**Follow-up**: `tvw` 의 `--url` 파서(`src-tauri/tvw/src/dsn.rs`)는 앱의
`parseConnectionUrl`(`src/features/connection/model.ts`)과 같은 계약을 자처하는데
읽는 범위가 더 좁다. #1770 은 못 읽는 부분을 조용히 버리는 대신 거부하도록 닫았고,
읽게 만드는 쪽은 아래 항목으로 이 큐에 남긴다. 승격 시점은 `tvw` 가 배포 대상이 될
때다(#1775).

- `sslmode=`: 앱은 posture 로 반영하고 반영 못 한 값은 사용자에게 고지한다
  (ADR 0053 결정 4). `tvw` 는 그 파라미터를 실은 DSN 을 거부한다 — 한 문장을 돌리고
  죽는 프로세스라 고지를 놓을 자리가 없고, 그냥 연결하면 사용자가 고른 적 없는
  `SslMode::Prefer`(기회적 암호화, 인증서 검증 없음)로 붙는다.
- sqlite DSN 의 `?mode=ro` 류: 지금은 거부하지만 사유는 위와 다르다. 반영할 자리는
  있다 — `ConnectionConfig.read_only` 는 core 가 끝까지 결선해 둔 필드고,
  `src-tauri/table-view-core/src/db/adapters/sqlite/connection.rs` 가 그 값으로
  `options.read_only(true)` 를 걸며 같은 어댑터의 `queries.rs` 가 read-only 연결에서
  DML 을 거절한다. 늘 `false` 인 것은 `tvw` 자신의 생성자다
  (`src-tauri/tvw/src/dsn.rs` 의 `config`). 그래서 이 항목은 그 한 줄을 DSN 에서
  받게 만드는 일이고, 어떤 `mode=` 값을 read-only 로 볼지가 결정 사항이다.
- database 이름 percent-decoding: 앱은 user·password 만 디코드하고 database 는 원문을
  남기는데 `tvw` 는 디코드한다. `postgres://h/d%20b` 가 앱에서 `d%20b`, `tvw` 에서
  `d b` 다.
- 앞 슬래시: 앱은 하나만 떼고 `tvw` 는 전부 뗀다. `postgres://h//db` 가 앱에서 `/db`,
  `tvw` 에서 `db` 다.

### CLI output typing

**Follow-up**: #2322 가 `--format table|json|csv` 의 출력을 고정하면서 닫은 것은
**문서가 나오느냐**는 축이다 — 행이 0인 SELECT 에서 stdout 이 비느냐 마느냐가 어느
엔진이 답했느냐에 달려 있던 자리이고, 처방은 `src-tauri/tvw/src/render.rs` 의
`render` 가 `columns` 대신 `rows` 와 format 으로 가르는 것이다. 남은 것은 **값과
메타데이터의 내용**이 엔진마다 다른 축이고, 승격 시점은 `tvw` 가 배포 대상이 될
때다(#1775).

- `--format json` 의 SQLite INTEGER 열: 같은 SELECT 가 SQLite 에서 `[["1"]]`,
  PostgreSQL 에서 `[[1]]` 이다. 어댑터가 그렇게 직렬화하는 것이 결정이고
  (ADR 0026 — 2^53 을 넘는 값이 raw JSON number 로 나가면 읽는 쪽 `f64` 가 무음
  손상시킨다,
  `src-tauri/table-view-core/src/db/adapters/sqlite/queries.rs`), 앱은
  `wrapNumericCells`(`src/lib/tauri/numericWrap.ts`)로 되돌리는데 CLI 에는 그 층이
  없다. `--format table` 과 `--format csv` 는 양쪽 다 따옴표 없는 토큰을 찍어 이
  차이를 안 보인다. CLI 에서 되돌리려면 `ColumnCategory` 를 보고 문자열을 숫자
  토큰으로 승격하는 층이 필요한데, 그것은 어댑터 계약을 CLI 한쪽에서만 뒤집는
  일이라 별도 결정이다.
- `--format json` 의 `columns` 배열: 행이 0인 SELECT 에서 PostgreSQL 은 describe 로
  잡은 컬럼을 이름과 함께 내고 SQLite·MySQL 은 낼 것이 없다. CLI 가 재구성할 근거가
  없어 어댑터가 아는 만큼 그대로 싣는다.

### Security / ops policy

**Follow-up**: Keep destructive/admin/security claims source-specific until a
threat-model handoff and source-specific implementation own
preview/confirm/dry-run/auditability. Users/roles/auth mechanism UI waits until
source order is clear.

Open items from #2183, which gave the connection store a single-generation
`connections.json.bak` and a restore path for a store that goes missing. Each was
left out deliberately and none has an owning issue yet; the shipped boundaries
are stated under *Connection store backup and recovery* in
[`known-limitations-cross-cutting.md`](../product/known-limitations-cross-cutting.md).
Promote any of them when a second loss report arrives, and prefer whichever the
report actually exercises:

- Generations beyond the previous one, a backup outside the app data directory,
  and a user-chosen backup location. The owner ruled the location trade-off
  accepted on 2026-08-06, so reopening it needs a new decision, not an
  implementation slice.
- A backup that fails to parse is set aside and the app boots empty with nothing
  said to the user — that path is visible only in the log, while a restore that
  put something back raises a toast. Telling the user their backup was unusable
  needs a second wire flag, and #2183 asked only for the success case to be
  reported.
- The corrupt-`connections.json` path still quarantines and boots empty without
  consulting the backup sitting next to it. Reading the backup there would make
  a parse failure recoverable the same way a missing file now is, but it changes
  what the existing quarantine test asserts and was outside what #2183 asked for.

### Quality gates

**Follow-up**: Promote a11y, perf, E2E isolation, dependency security CI, and
platform smoke gaps from `testing-and-quality.md` only when they block an active
feature lane and have owner/runtime-cost/triage paths. Link checking left this
list in #2125: internal markdown link targets are now checked by
`scripts/docs-links.ts` as a blocking frontend test. External URLs were not part
of that promotion and stay unchecked. Open item from #2174: the `PR Body
Contract` comment in `ci.yml` records `check-ci-test-calls.sh` at 0.18s, which
review of that PR did not reproduce — it measured 0.07-0.08s. The figure is
quoted with its command but not with the machine, load, or warm/cold state, so
nothing makes the two runs comparable. Sibling steps in that job carry figures
written the same way and were not re-measured. Pin the measurement conditions
or drop the figures.

### Agent tooling — repo-recon MCP

**Follow-up**: #2289 이 `scripts/mcp/repo-recon/server.mjs` 와 루트 `.mcp.json` 으로
정찰 tool (`repo_grep` · `repo_show` · `repo_ls` · `repo_git`) 만 올렸고, 아래는 그
티켓이 범위 밖으로 못박아 소유 이슈 없이 남았다. 승격은 노드가 이 서버를 실제로 쓰기
시작할 때다.

- `.claude/agents/*.md` 에 `tools:` 를 선언해 노드별 권한을 좁히는 것. 지금 그 정의들은
  `tools:` 를 안 적어 전체 tool 을 상속하므로, 서버가 등록돼도 노드가 정찰을 이쪽으로
  돌릴 이유가 없다. 이 배선이 오기 전까지 서버의 값은 "쓸 수 있다" 까지다.
- `gh` 읽기 tool (PR body · 체크 상태 · 코멘트). 지금은 노드가 `gh` 를 셸로 부르므로
  `repo_grep` 이 없앤 인용 · glob 삼킴 유형이 그 경로에는 그대로 남는다.
- 쓰기 tool (scorecard 게시 · verdict label). 읽기 tool 과 달리 권한 경계가 붙으므로
  별도 결정이 필요하다.

### Refactor backlog

**Follow-up**: Promote code-smell audit candidates only when they intersect
active feature work or remove current maintenance cost. 2026-07-25 검증에서 기존
near-term candidate 3종이 전부 완료/규범화로 판명돼 걷어냈다 (#1790): `src/lib/runtime/**` 이동은
완료됐고, legacy 직접 `setState` 는 0건이며 ESLint `tv-local/no-direct-zustand-setstate` 가
강제하고, dialog preset mandate 는 이미 retired 다. 현재 등록된 near-term candidate 는 없다.

