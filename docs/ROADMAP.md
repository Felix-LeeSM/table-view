# Table View — Long-Term Roadmap

## Purpose

Long-term 방향을 잃지 않기 위한 전략 문서. `docs/PLAN.md` 는 active-only
실행 순서이고, 이 문서는 그 뒤에 남는 product / architecture horizon 을
관리한다.

본 문서는 sprint 번호를 배정하지 않는다. Implementation sprint 번호는 실행
직전에 `docs/PLAN.md` 와 `docs/sprints/sprint-N/` 에서 배정한다.

## North Star

TablePlus 사용자가 핵심 워크플로우를 잃지 않고 Table View 로 전환할 수 있어야
한다.

Core workflow:

1. Connect
2. Browse
3. Query
4. Edit
5. Review / commit safely
6. Inspect server state when something goes wrong

Strategic constraints:

- Local-first desktop app. Credentials, history, settings, and app state stay
  local unless user explicitly exports them.
- RDBMS parity comes first: PostgreSQL, MySQL, MariaDB, SQLite, then DuckDB/file
  analytics.
- MongoDB, Redis/Valkey, and Elasticsearch/OpenSearch are first-class
  non-RDBMS targets after the data-source extension architecture is in place.
- Cassandra/Scylla, DynamoDB, graph DB, vector DB, and stream sources remain
  candidate paradigms until their workflow and adapter contracts are explicit.
- SQL and mongosh completion/parser vocabulary live in Rust/WASM. TypeScript
  fallback mirrors are compatibility only.
- Dangerous writes route through preview, Safe Mode, or explicit confirmation.
- Active plans stay short. Completed and inactive docs move to `docs/archives/`.

## Horizon Order

| Horizon | Goal | Why It Comes Here | Exit Signal |
|---:|---|---|---|
| H1 | Current code -> data-source architecture alignment | RDBMS + DuckDB + Redis/Search/Graph/Vector expansion will otherwise create switch sprawl. The existing code must enter the new shape before more feature work. | Current `DatabaseType`/`Paradigm`/`ActiveAdapter`/workspace query/result paths are wrapped by profiles, capabilities, query languages, and result envelopes without user-facing regression. |
| H2 | RDBMS parity | Current architecture is strongest here and user-visible gaps are direct TablePlus migration blockers. | MySQL semantic gaps shrink; MariaDB reuse/delta is locked; SQLite user DBMS adapter is green. |
| H3 | DuckDB + file analytics | Local-first file analytics extends RDBMS work without a new paradigm. | `.duckdb`, CSV, Parquet, JSON preview/query basics and file privacy rules are green. |
| H4 | RDBMS intelligence | ERD/schema diff/data compare/migration preview reuse the same RDB catalog graph. | `SchemaGraph` powers ERD, FK navigation, dependency view, and migration impact analysis. |
| H5 | First-class non-RDBMS | MongoDB, Redis/Valkey, Elasticsearch/OpenSearch cover the clearest non-RDBMS user workflows. | Document/KV/Search adapter contracts are real, not marker traits; paradigm-specific workbenches are green. |
| H6 | Broader paradigms | Cassandra, DynamoDB, graph DB, vector DB, and stream sources need explicit workflow proof before active work. | Each candidate has profile, connection kind, language, catalog model, result envelope, safety policy, and fixture strategy. |
| H7 | Operations, security, reliability | Broad source support must be inspectable, safe, and routinely verified. | Active risk register shrinks; key ops/security/a11y/perf smoke paths become routine gates. |

## Track Map

| Track | Long-Term Direction | Current Anchor |
|---|---|---|
| Data-source architecture | New DBMS/support surfaces enter through profile, capability, adapter, language, catalog, result envelope, and safety contracts. | `docs/data-source-architecture.md`, ADR 0046 |
| RDBMS runtime | Strong support for PostgreSQL, MySQL, MariaDB, SQLite, and DuckDB/file analytics before widening to uncertain paradigms. | `docs/PLAN.md`, `docs/phases/phase-18.md`, `docs/phases/phase-19.md` |
| Non-RDBMS runtime | MongoDB, Redis/Valkey, and Elasticsearch/OpenSearch are first-class non-RDBMS targets; Cassandra/DynamoDB/graph/vector are gated candidates. | `docs/data-source-architecture.md`, `docs/phases/phase-28.md` |
| Language core | Rust/WASM owns hot-path parse/completion vocabulary, context routing, and capability gates where practical. | ADR 0045, `docs/query-language-support.md`, `docs/archives/phases/completed/phase-31.md` |
| Query editor | Query surface is selected by `queryLanguage` and workbench paradigm, not legacy `queryMode`. | `docs/data-source-architecture.md`, `docs/phases/phase-28.md` Slice A |
| Data editing | Preview/commit/discard, bulk operations, and per-paradigm edit semantics. | completed Phases 22-23, Phase 28 |
| Schema / DDL | RDB DDL parity is mostly closed; ERD/schema graph is the next reusable intelligence layer. | completed Phases 24-27, `docs/data-source-architecture.md` |
| Operations | Explain/activity/stats/server info/profiler surfaces after core parity. | `memory/roadmap/unified-followups/memory.md` |
| Security | Credential/key handling, role/user management, auth mechanism expansion, destructive action policy. | `docs/RISKS.md`, `memory/roadmap/unified-followups/memory.md` |
| App state | SQLite-backed durable app state, query history, settings, keyring, cross-window sync. | `docs/state-management-strategy-2026-05-15.md` |
| Quality | CI, E2E smoke, perf/a11y baselines, testing reliability, refactor backlog burn-down. | `docs/RISKS.md`, `docs/archives/audits/code-smell-audit-2026-05-15.md` |

## Sequencing Rules

1. Close visible incomplete workflows before adding new partial workflows.
2. Prefer depth in an existing runtime over adding another runtime that exposes
   only connect/browse/query.
3. Parser/Safe Mode/completion support must be explicit. Unsupported syntax is
   acceptable only when documented in `docs/query-language-support.md`.
4. Any new DBMS must define:
   - data-source profile and paradigm
   - connection config shape
   - adapter/protocol ownership
   - capability profile
   - query language(s)
   - catalog/sidebar namespace model
   - result envelope kind(s)
   - query execution semantics
   - edit and DDL support level
   - safety policy
   - testcontainer or local fixture strategy
5. Any new long-lived state must define:
   - source of truth
   - durability
   - privacy/export behavior
   - reset-to-default affordance
   - cross-window sync behavior
6. Feature work that changes shared UI must include regression scope for every
   paradigm sharing that surface.
7. Completed or inactive planning moves to archives. `docs/PLAN.md` remains
   active-only.

## Decision Gates

Before promoting a roadmap item into active implementation:

| Gate | Required Output |
|---|---|
| User discussion | Scope, order, and non-goals agreed before implementation starts. |
| SOT check | Existing `docs/PLAN.md`, phase docs, risk docs, and memory links updated or declared unchanged. |
| Risk check | New risks added to `docs/RISKS.md`, or existing risks referenced. |
| Contract check | Acceptance criteria and verification commands are known before coding. |
| Architecture check | ADR required only when changing a durable decision or reversing previous direction. |
| Archive check | Old draft/spec docs are archived or linked as historical context. |

## Open Questions

| Area | Question | Default Until Decided |
|---|---|---|
| MongoDB | How should transaction toggle behave on standalone servers? | Friendly failure + documented fallback; no silent partial commit. |
| MongoDB | How much arbitrary shell behavior should Query Editor accept? | Whitelist only; no arbitrary JavaScript execution. |
| MariaDB | Can MySQL adapter reuse stay simple? | Reuse with dialect flag; split only with evidence. |
| SQLite DBMS | Should unsupported ALTER TABLE be disabled or auto-rebuilt? | Disable + tooltip until ADR chooses rebuild. |
| DuckDB | Should file analytics live as RDBMS or separate file-sql paradigm? | Treat as RDBMS + `file` connection kind until evidence requires split. |
| Redis/Search | When can marker traits become active adapters? | Only after `KvAdapter` / `SearchAdapter` contracts are real. |
| Broader paradigms | Which of Cassandra/DynamoDB/graph/vector/stream gets promoted first? | Do not promote until workflow value and profile contract are clear. |
| App state | When should state-management migration resume? | After DB support work no longer conflicts with storage/schema surfaces. |
| Security | When to add users/roles/auth mechanism UI? | After RDBMS/DuckDB/non-RDBMS source order is clear. |

## Promotion Targets

The next likely promotions, in order:

1. Current code -> data-source architecture alignment.
2. Data-source profile/capability foundation.
3. Query language / result envelope migration.
4. Adapter contract normalization.
5. MySQL-family semantic widening continuation.
6. MariaDB Slice 18A.
7. SQLite Slice 19A.
8. DuckDB + file analytics phase definition.
9. RDBMS ERD / `SchemaGraph`.
10. Redis/Valkey `KvAdapter` contract.
11. Elasticsearch/OpenSearch `SearchAdapter` contract.
12. MongoDB Phase 28 resume.

Changes to this order should update this file and `docs/PLAN.md` together.
