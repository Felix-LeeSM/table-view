# Sprint Execution Brief: sprint-178

## Objective

Postel's Law — connection input normalization for `ConnectionDialog`. Make the form-mode dialog accept the inputs users naturally produce: a connection URL pasted into the host field (8 schemes — `postgres`, `postgresql`, `mysql`, `mariadb`, `mongodb`, `mongodb+srv`, `redis`, sqlite-file URL), stray whitespace around any non-password string field, and the `host:NNNN` shorthand on blur. Malformed scheme-shaped pastes are silently absorbed (no error toast). Passwords never leak into alerts. Sprints 176 and 177 have shipped; this builds on top, not replaces.

## Task Why

Postel's Law: be liberal in what you accept, conservative in what you produce. The current `ConnectionDialog` has an explicit "URL" mode toggle and a working `parseConnectionUrl` helper, but a user who pastes `postgres://u:p@h:1234/db` directly into the form-mode host field gets that literal string saved as the host (and connection-test fails with a confusing error). Paste / trim / split friction is the highest-frequency form-input frustration in the dialog — every TablePlus-like tool the user might be migrating from accepts these inputs without the user thinking about it. The infrastructure to fix this is already shipped (`parseConnectionUrl`, the `URL` mode flow); this sprint extends acceptance to where the user actually pastes (the host field) and adds the two missing schemes (`mongodb+srv`, `mariadb`).

A second motive is the password-leak guard (AC-178-05). Once paste detection is on, error paths can naively echo the pasted URL — including the password — into alerts. The sprint enforces that no `role="alert"` / `role="status"` / `aria-live` region ever surfaces the password substring, satisfying ADR-0005 (passwords stay encrypted backend-side; the renderer never displays them).

## Scope Boundary

**In**:
- `src/components/connection/ConnectionDialog.tsx` — form-mode host paste detection, save-time trim, `host:port` blur split, non-modal "detected" affordance.
- `src/types/connection.ts` — `parseConnectionUrl` recognizes `mongodb+srv` and `mariadb`; `mongodb+srv` → `db_type: "mongodb"`, `mariadb` → `db_type: "mysql"`.
- `src/types/connection.test.ts` — parser tests for new schemes + edge cases.
- `src/components/connection/ConnectionDialog.test.tsx` — UI tests for AC-178-01..05.
- `docs/sprints/sprint-178/findings.md`, `docs/sprints/sprint-178/handoff.md`.

**HARD out**:
- **No IPC changes**. `testConnection`, `addConnection`, `updateConnection` consumers are called the same way; only frontend payloads are normalized.
- **No password trimming**. `password` is excluded from the trim list and sent verbatim. A user with whitespace-padded password keeps it.
- **No Rust changes**. `src-tauri/` is untouched. Sprint 178 is a frontend-only behavior fix.
- **No new `DatabaseType` variants**. `mongodb+srv` and `mariadb` are URL-scheme aliases that map to existing `DatabaseType` values (`mongodb` and `mysql`); the rest of the app (form rendering, backend dispatch) sees no new types.
- **No SSH field additions**. AC-178-02 mentions SSH fields "when introduced" — they are not introduced in this sprint.
- **No cross-paradigm "URL parser registry" / generic plugin layer**. The action plan suggests `src/lib/connection/urlParser.ts`; the Generator can extract OR extend in place — behavior is what matters, not module layout.
- **No URL-mode toggle changes**. The existing `Form ↔ URL` toggle, `urlValue` state, `Parse & Continue` button, and "Invalid URL" copy at `ConnectionDialog.tsx:341-426` continue exactly as today. Sprint 178 only adds detection on the form-mode host field.

**Defer (mentioned for the Generator's awareness, not in this sprint)**:
- Sprint 179 (paradigm vocabulary dictionary) — separate sprint.
- Sprint 180 (cancel overlay for async vectors) — separate sprint.
- Cross-paradigm capability adapter / new ADR — out of scope.

## Invariants

- URL-mode toggle path unchanged (the explicit `Parse & Continue` flow with its `urlError` message still works exactly as today).
- IPC commands unchanged (no `invoke()` signature change, no Rust handler change).
- No plaintext password leaves the frontend without IPC (ADR-0005). The password substring never appears in any `role="alert"` / `role="status"` / `aria-live` region.
- `password` is excluded from the trim list — sent verbatim.
- Malformed URL pastes are silent (no toast, no alert, no role="status" region added).
- `paradigm` mapping preserved: `mongodb+srv → "document"`, `mariadb → "rdb"`.
- `parseConnectionUrl` keeps its `Partial<ConnectionDraft> | null` return shape.
- `DATABASE_DEFAULTS` / `DATABASE_DEFAULT_FIELDS` unchanged (no new keys).
- Skip-zero gate (no `it.skip` / `it.todo` / `xit`); strict TS (no `any`); no `console.log` in production paths.
- No new runtime dependencies; no `package.json` change.

## Done Criteria

1. `AC-178-01`: Pasting any of the 8 recognized URLs (`postgres`, `postgresql`, `mysql`, `mariadb`, `mongodb`, `mongodb+srv`, `redis`, `sqlite:` file URL) into the form-mode host field populates `db_type` / `host` / `port` / `user` / `database` / `password` (where present) in one step AND a non-modal "detected" affordance is rendered.
2. `AC-178-02`: `name`, `host`, `database`, `user`, `group_name` (if present) have leading/trailing whitespace stripped before save/test; `password` is sent verbatim.
3. `AC-178-03`: `host:NNNN` blur splits the digit suffix into `port`; IPv6 inputs (`[::1]:5432`, `fe80::1`) leave host unchanged; non-digit ports do not split.
4. `AC-178-04`: Malformed URL pastes (`postgres://`, `mysql://@`, etc.) leave the host field unchanged AND add no error toast / no `role="alert"` / no `role="status"` element.
5. `AC-178-05`: Password substring (raw or URL-encoded) is absent from every `role="alert"` / `role="status"` / `aria-live` region's `textContent` at every step of the paste / detect / save flow — including a save-error path that naively echoes the connection string.

## Verification Plan

- Profile: `mixed` (browser + command + static). Browser smoke is operator-driven and limited to AC-178-01 paste flow + the "detected" affordance + the trim-on-save round-trip.
- Required checks:
  1. `pnpm vitest run src/types/connection.test.ts src/components/connection/`
  2. `pnpm vitest run` (full suite)
  3. `pnpm tsc --noEmit`
  4. `pnpm lint`
  5. Static: `grep -n -E '"postgres|"mysql|"mariadb|"mongodb|"redis|sqlite:' src/types/connection.ts` — confirms all 8 schemes are enumerated in the parser.
  6. Browser smoke: paste each of `postgres://u:p@h:1234/db` and `mongodb+srv://user:secret@cluster.example.com/mydb` into the form-mode host field; confirm field population + affordance. Type `localhost:5433` → blur → confirm split. Type `[::1]:5432` → blur → confirm no split. Save with whitespace-padded `name`/`host` → re-open → confirm trimmed.
- Required evidence:
  - Changed files list with one-line purposes.
  - Vitest output for `[AC-178-0X]`-tagged tests.
  - Per-scheme paste assertion table for AC-178-01.
  - Outgoing-payload assertion for AC-178-02 showing trimmed strings + verbatim password.
  - IPv4 / IPv6 / non-digit-port test rows for AC-178-03.
  - `queryAllByRole("alert").length` baseline-vs-after-paste comparison for AC-178-04.
  - Walk-all-alerts test + save-error sanitization test for AC-178-05.
  - `findings.md` with: mechanism note (paste vs change trigger, trim location, host:port regex, affordance shape), error-display sanitization audit, browser smoke summary, evidence index.

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes (full Vitest, tsc, lint, static grep)
- Done criteria coverage with evidence (per-AC test name + assertion text)
- Assumptions made during implementation:
  - Paste vs change trigger choice for URL detection
  - Whether `parseConnectionUrl` was extended in place or extracted to a new module
  - Trim helper location and shape
  - Host:port split regex (and the IPv6 cases it rejects)
  - Affordance shape (inline note vs toast vs banner) and copy
- Residual risk or verification gaps:
  - Browser smoke skipped for any scheme that requires a live backend (e.g. `mongodb+srv` needs DNS — note the gap)
  - Any other consumer of `parseConnectionUrl` discovered during implementation that needs migration
  - Edge-case schemes the user might paste that do not map cleanly to the 8 recognized (e.g. `cockroachdb://` — falls through to `null`, same as any unknown scheme today)
- Audit list of `setError` / `setUrlError` / `setTestResult({status:"error"})` call sites and their sanitization treatment
- List of any existing-test rewrites in `ConnectionDialog.test.tsx` and the rewrite reason

## References

- Contract: `docs/sprints/sprint-178/contract.md`
- Spec: `docs/sprints/sprint-176/spec.md` (Sprint 178 section, lines 52–70; spec hosts all five sprints; see also Discrepancies §C.5 and §C.6)
- Action plan: `docs/ux-laws-action-plan.md` §C
- Sprint-177 contract (style template only): `docs/sprints/sprint-177/contract.md`
- Findings (to be created): `docs/sprints/sprint-178/findings.md`
- Relevant files:
  - `src/components/connection/ConnectionDialog.tsx` — host field at lines 428+, save handler at 219–252, URL-mode flow at 341–426 (untouched), error region at 583–590
  - `src/types/connection.ts` — `parseConnectionUrl` at line 192; scheme map at lines 212–218 (extension target); `parseSqliteFilePath` at line 241 (preserved)
  - `src/types/connection.test.ts` — parser test suite (extension target)
  - `src/components/connection/ConnectionDialog.test.tsx` — UI test suite (extension target)
  - `src/stores/connectionStore.ts` — IPC consumer (NOT modified; only its payload is normalized)
  - `memory/decisions/` — ADR-0005 (passwords stay backend-side; AC-178-05 enforces this)
  - `memory/conventions/memory.md` — test rules, naming, skip-zero gate
  - `.claude/rules/test-scenarios.md` — scenario checklist
