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
- PostgreSQL/MySQL/MariaDB/SQLite and MongoDB are first-class before adding
  long-tail DBMS.
- SQL and mongosh completion/parser vocabulary live in Rust/WASM. TypeScript
  fallback mirrors are compatibility only.
- Dangerous writes route through preview, Safe Mode, or explicit confirmation.
- Active plans stay short. Completed and inactive docs move to `docs/archives/`.

## Horizon Order

| Horizon | Goal | Why It Comes Here | Exit Signal |
|---:|---|---|---|
| H1 | MongoDB full support | Existing Mongo surface is visible but incomplete. Closing it improves a current user-facing workflow more than adding another partial DBMS. | Phase 28 ACs pass; unified mongosh editor, Mongo data editing, indexes/views/DDL, and RDB regressions are green. |
| H2 | MySQL-family semantic depth | MySQL runtime exists. Parser/Safe Mode/completion semantics should catch up before widening more DBMS. | `CALL`, user variables, routine scripting, `DELIMITER`, `LOAD DATA`, and capability-gated completion are either supported or explicitly unsupported. |
| H3 | MariaDB + SQLite DBMS adapters | MariaDB is high leverage after MySQL. SQLite is a common local DBMS but must be separated from internal app SQLite state. | MariaDB reuses MySQL adapter or records ADR for split; SQLite file connection/read-only/write basics are green. |
| H4 | Unified operations | Users need inspectability across paradigms after query/edit parity: explain, stats, activity, server info, slow query/profiler. | RDB and Mongo expose equivalent operational panels where the underlying paradigm supports them. |
| H5 | App state/storage maturity | Durable app behavior matters once DB workflows are broad: workspace state, query history, settings, keyring, cross-window sync. | State-management contracts are re-audited against current code and executed without regressing DB workflows. |
| H6 | Reliability / UX hardening | Broad feature coverage must be backed by measurable accessibility, performance, E2E isolation, and responsive layout. | Active risk register shrinks; key UI/perf/a11y smoke paths become routine gates. |
| H7 | Long-tail DBMS / ecosystem | Oracle/MSSQL/Redis/Elasticsearch/etc. should wait until adapter/paradigm extension points are boring. | New DBMS can be added mostly by adapter/profile work, not new app architecture. |

## Track Map

| Track | Long-Term Direction | Current Anchor |
|---|---|---|
| DBMS runtime | Strong support for PostgreSQL, MySQL, MariaDB, SQLite, MongoDB before long-tail engines. | `docs/PLAN.md`, `docs/phases/phase-18.md`, `docs/phases/phase-19.md`, `docs/phases/phase-28.md` |
| Language core | Rust/WASM owns SQL and mongosh parse/completion vocabulary, context routing, and capability gates. | ADR 0045, `docs/query-language-support.md`, `docs/archives/phases/completed/phase-31.md` |
| Query editor | One editor model per paradigm with safe typed dispatch. No arbitrary Mongo JavaScript execution. | `docs/phases/phase-28.md` Slice A |
| Data editing | Preview/commit/discard, bulk operations, and per-paradigm edit semantics. | completed Phases 22-23, Phase 28 |
| Schema / DDL | RDB DDL parity is mostly closed; Mongo collection/view/index/validator DDL remains. | completed Phases 24-27, Phase 28 |
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
   - connection config shape
   - adapter/protocol ownership
   - schema/sidebar namespace model
   - query execution semantics
   - edit and DDL support level
   - testcontainer or local fixture strategy
5. Any new long-lived state must define:
   - source of truth
   - durability
   - privacy/export behavior
   - reset-to-default affordance
   - cross-window sync behavior
6. Feature work that changes shared UI must include RDB + Mongo regression scope
   when both paradigms share the surface.
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
| App state | When should state-management migration resume? | After DB support work no longer conflicts with storage/schema surfaces. |
| Security | When to add users/roles/auth mechanism UI? | After Phase 28 or unified operations scope is clear. |
| Long-tail DBMS | Which DBMS follows core set? | Decide by user workflow value and adapter cost; Oracle remains deferred. |

## Promotion Targets

The next likely promotions, in order:

1. Phase 28 Slice A1 — unified mongosh editor routing.
2. MySQL-family semantic widening continuation.
3. Completion capability filtering.
4. MariaDB Slice 18A.
5. SQLite Slice 19A.
6. RISK-038 refactor candidates that unblock active feature work.
7. State-management re-audit.

Changes to this order should update this file and `docs/PLAN.md` together.
