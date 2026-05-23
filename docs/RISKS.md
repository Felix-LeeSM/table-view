# Active Risk Register — Table View

Active/deferred risk 단일 추적 문서. Resolved risk 는
`docs/archives/risks/resolved-risks.md` 에서 관리한다.

Last updated: 2026-05-23 (Sprint 459 RDBMS integration gate)

## Summary

| Status | Count |
|---|---:|
| Active | 26 |
| Deferred | 1 |
| Resolved | 17 |
| Total | 44 |

## Active / Deferred Risks

| ID | Description | Status | Area | Origin | Resolution target |
|---|---|---|---|---|---|
| RISK-008 | `commands/connection.rs` async commands (`connect`, `disconnect`, `keep_alive_loop`) need Tauri `AppHandle` mock coverage | active | backend | 14 | backend command test harness |
| RISK-010 | Port 5432 local conflict; env override only partially covers local dev | active | infra | 16 | deterministic local DB port allocation |
| RISK-011 | CSS class-name assertions can break during refactor | active | frontend/testing | 5, 8 | prefer role/label/behavior assertions |
| RISK-012 | Mod-Enter test relies on jsdom/keymap direct call limits | active | frontend/testing | 6 | browser/smoke coverage or keymap seam |
| RISK-013 | `MainArea` child components are over-mocked, hiding prop contract drift | active | frontend/testing | 6 | integration-level coverage |
| RISK-014 | Theme icons are not distinguishable by SVG assertions | active | frontend/testing | 8 | accessible labels / visual smoke |
| RISK-015 | `ConnectionConfigLike` test type duplicates production shape | active | frontend/testing | 8 | reuse production type or builder |
| RISK-016 | `draggedConnectionId` mock is indirect and fragile | active | frontend/testing | 9, 10 | behavior-level DnD coverage |
| RISK-017 | Skip pattern mismatch between query/schema integration tests | active | backend/testing | 16 | normalize integration skip policy |
| RISK-019 | Schema integration 12 tests require Docker DB locally | active | ci | 14-16 | local-dev service bootstrap docs |
| RISK-020 | macOS E2E unsupported due tauri-driver WKWebView limitation | deferred | ci | 15 | upstream driver support or alternate mac smoke |
| RISK-021 | CHECK constraint expression is raw SQL by design | active | backend | 22 | keep documented as intentional DB-tool behavior |
| RISK-022 | E2E right-click unsupported by tauri-driver W3C Actions gap | active | e2e | E2E stabilization | alternate context-menu trigger or driver fix |
| RISK-023 | E2E test state isolation weak (`maxInstances: 1`, reused app instance) | active | e2e | E2E stabilization | reset fixture before each smoke |
| RISK-026 | 72 themes x light/dark WCAG AA not fully measured | active | frontend/a11y | UI eval | contrast baseline + allowlist |
| RISK-027 | SchemaTree 1k/10k table scroll FPS not measured | active | frontend/perf | UI eval | FPS/DOM row budget measurement |
| RISK-028 | DataGrid page size 1000 wheel latency not measured | active | frontend/perf | UI eval | wheel-to-paint latency budget |
| RISK-029 | VoiceOver/NVDA paths for Quick Open/DataGrid/SchemaTree unverified | active | frontend/a11y | UI eval | screen-reader pass |
| RISK-030 | 1024x600 min-size with max sidebar + dialog overlap unverified | active | frontend/ui | UI eval | min viewport visual check |
| RISK-031 | Cmd+Shift+I may collide with DevTools in Tauri prod | active | tauri | UI eval | prod shortcut audit |
| RISK-032 | `MainArea` EmptyState MRU policy undecided | active | frontend/ux | UI eval | MRU decision + rationale |
| RISK-034 | `pendingEditErrors` in narrow columns may clip | active | frontend/ui | UI eval | tooltip/hover or layout proof |
| RISK-037 | `hickory-proto` CVEs pinned through `mongodb 3.6.0`; deny ignore in place | active | backend/security | hooks setup | migrate to `mongodb 4.x` or `hickory-proto 0.25.3+` |
| RISK-038 | Code smell audit Part A 12 candidates remain outside state-management plan | active | refactor backlog | `docs/archives/audits/code-smell-audit-2026-05-15.md` | register each candidate as sprint or retire audit |
| RISK-042 | MySQL/MariaDB version-aware capability gates are typed/tested metadata but not yet wired through runtime/UI capability lookup | active | frontend/capabilities | Sprint 458, Sprint 459 | route feature gates through server-version-aware profile context |
| RISK-043 | MariaDB runtime support reuses the MySQL adapter path without a MariaDB-engine integration fixture in CI | active | backend/testing | Sprint 451, Sprint 459 | add MariaDB service fixture smoke or narrow public support claim |
| RISK-044 | Result envelope migration remains a compatibility layer; IPC still returns legacy `QueryResult` for RDBMS runtimes | active | query/results | Sprint 444, Sprint 459 | move query IPC boundary to typed result envelopes |

## Notes

- `RISK-018` moved to resolved: Phase 17 MySQL adapter closed in Sprint 296.
- `RISK-033` moved to resolved: Phase 28 + roadmap memory now define Mongo edit milestone.
- `RISK-039`-`RISK-041` moved to resolved after Sprint 433-438 follow-ups.
- `RISK-042`-`RISK-044` added by Sprint 459 RDBMS integration gate.
