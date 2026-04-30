# Sprint Contract: sprint-178

## Summary

- Goal: Apply Postel's Law to `ConnectionDialog` form-mode input — be liberal in what the dialog accepts so users can paste a connection URL into the host field, leave whitespace around any non-password string field, type `host:NNNN` without manually splitting, and add the two missing schemes (`mongodb+srv`, `mariadb`) plus a sqlite-file URL form. Malformed schemes are silently absorbed (no error toast). No password value ever appears in user-visible alerts. Sprints 176/177 have shipped; this builds on top, not replaces.
- Audience: Generator (single agent) — implements; Evaluator — verifies AC + evidence.
- Owner: harness orchestrator
- Verification Profile: `mixed` (browser + command + static). Browser smoke is operator-driven and limited to AC-178-01 + the "detected" affordance.

## In Scope

- `AC-178-01`: When the user pastes a recognized connection URL (postgres / postgresql / mysql / mongodb / mongodb+srv / mariadb / redis / sqlite-file-URL) into the host field while the dialog is in form mode, the dialog populates `db_type`, `host`, `port`, `user`, `database`, and (where present) `password` from the URL within one user-visible step, and a non-modal affordance informs the user the URL was detected (e.g. an inline note or toast — NOT a modal dialog and NOT an alert that blocks form interaction). Verifiable via Vitest tests that paste each scheme and assert the resulting form state plus the presence of the affordance.
- `AC-178-02`: All string fields that the user would not deliberately bracket with whitespace (`name`, `host`, `database`, `user`, `group_name` if present, plus any SSH fields when introduced) have leading/trailing whitespace stripped before the connection is saved or tested. The `password` field is excluded — it is sent verbatim. Verifiable via Vitest tests on the save handler with whitespace-padded inputs and assertions on the outgoing `addConnection` / `updateConnection` / `testConnection` payload.
- `AC-178-03`: When the host field's value contains a single `:` followed by digits and the user blurs the field, the digit suffix is moved to the `port` field and the host field retains only the hostname portion. Pure IPv6 addresses (containing `[…]:port` brackets or multiple `:`) are NOT misinterpreted — only single-colon `host:NNNN` triggers the split. Verifiable via Vitest tests covering IPv4-style hostname (`localhost:5433` → host `localhost`, port `5433`) and IPv6-style inputs (`[::1]:5432`, `fe80::1`) where the host field must remain unchanged.
- `AC-178-04`: An input that begins with `://` or a known scheme but is malformed (e.g. `postgres://` with no host, `mysql://@`) leaves the host field's value untouched and does NOT raise an error toast — best-effort ingest, not a hard failure. Verifiable via Vitest tests asserting the input survives unchanged in the form state and `screen.queryByRole("alert")` and `screen.queryByRole("status")` for sprint-178 code paths return null (or are limited to pre-existing slots that do not contain error copy).
- `AC-178-05`: No password value (raw or URL-encoded) appears in any toast / error / `role="alert"` / `role="status"` / `aria-live` region surfaced by this sprint's code paths. Verifiable via a Vitest test that pastes a URL containing a unique-string password (e.g. `pass123ZZ`), then asserts the password substring is absent from every `role="alert"` and `role="status"` node's `textContent` in the DOM at every visible step (paste / detect / save error path).

Files allowed to modify (per spec "Components to Create/Modify"):

- `src/components/connection/ConnectionDialog.tsx` — form-mode host field gains URL-detection on paste; whitespace trim is applied at save / test time on `name`, `host`, `database`, `user`, `group_name` and any SSH fields if present (NOT `password`); `host:port` split is applied on blur; the non-modal "detected" affordance is rendered.
- `src/types/connection.ts` — `parseConnectionUrl` extends recognized schemes to include `mongodb+srv` and `mariadb`. Parser returns the same `Partial<ConnectionDraft>` shape; `mongodb+srv` resolves to `db_type: "mongodb"` (SRV is a transport semantic the backend resolves; frontend preserves the host as-is per spec §Edge Cases §C.4); `mariadb` resolves to `db_type: "mysql"` (MariaDB is wire-compatible and the backend uses the MySQL adapter).
- `src/types/connection.test.ts` — extend test suite for the new schemes and edge cases (encoded password, IPv6 input that the parser must NOT accept as a valid URL because IPv6 needs brackets, `host:port`-only inputs, malformed URLs).
- `src/components/connection/ConnectionDialog.test.tsx` — extend the existing test file with AC-178-01 through AC-178-05 cases (paste, trim, split, malformed, password leak guard).
- `docs/sprints/sprint-178/findings.md` (new) — Generator notes: mechanism choice (where the paste handler lives, whether trim happens in `handleSave`/`handleTest` or before payload assembly, where the affordance is rendered), browser smoke summary, evidence index.
- `docs/sprints/sprint-178/handoff.md` (sprint deliverable; standard harness output).

## Out of Scope

- Anything in Sprints 179 / 180 (paradigm vocabulary dictionary, Doherty + Goal-Gradient cancel overlay).
- SSH tunnel fields. AC-178-02 says "plus any SSH fields when introduced" — if SSH fields are NOT in the current `ConnectionDraft` (verified during contract drafting: they are not), the trim logic must be future-safe (e.g. an explicit list of trimmed keys, easy to extend) but the Generator does NOT add SSH fields in this sprint.
- A cross-paradigm capability adapter or a "URL parser registry" / generic plugin surface. The action plan suggests `src/lib/connection/urlParser.ts` as a new module; the Generator may choose to extract OR extend `parseConnectionUrl` in place — the AC describe behavior, not module location (per the planner rule, ref discrepancy §C.6).
- Modifying any backend IPC command. The connection-test (`testConnection`) and connection-save (`addConnection` / `updateConnection`) IPC commands are unchanged; only the frontend payload is normalized before invocation.
- Modifying the existing URL-mode toggle path (the explicit "URL" button + `urlValue` / `urlError` state + `Parse & Continue` button at `ConnectionDialog.tsx:341-426`). That path stays as-is; this sprint only adds detection on the form-mode host field.
- Changing `parseSqliteFilePath` semantics — the existing path-only fallback is preserved; the new "sqlite-file-URL" support means `parseConnectionUrl` continues to handle `sqlite:/path` URLs (already supported) AND the form-mode host field now treats a `sqlite:` URL paste the same as the URL-mode `Parse & Continue` flow does today.
- E2E test changes — no e2e selector currently asserts on the host field's behavior in this scope. If a future e2e selector breaks because of the trim-on-save change, that update is in scope; verified during contract drafting that no existing e2e relies on whitespace-padded saved values.
- ADR or `memory/decisions/` updates. Sprint 178 is a frontend behavior fix, not a paradigm/architecture decision.
- Any change to `password` handling: the password input flow (`passwordInput`, `clearPassword`, `resolvePassword`) and the existing semantics (`null` = unchanged, `""` = clear, non-empty = set) are preserved verbatim.

## Invariants

- **URL-mode toggle path unchanged**: the explicit `Form ↔ URL` toggle, the `urlValue` / `urlError` state, the `Parse & Continue` button, and the existing "Invalid URL" copy at `ConnectionDialog.tsx:406-408` continue to render and behave exactly as today. The sprint-178 detection lives on the form-mode host field, not on the URL-mode input.
- **IPC commands unchanged**: `testConnection`, `addConnection`, `updateConnection` from `connectionStore` are called with the same shape; only the values inside the `ConnectionDraft` are trimmed.
- **Password never leaves frontend without IPC**: per ADR-0005 (passwords kept in encrypted backend store), the password value lives only in `passwordInput` state and the `ConnectionDraft.password` field at the moment of IPC invocation. AC-178-05 enforces that no rendering path (toast, alert, aria-live, status region) ever surfaces the password substring.
- **Password trim excluded**: `password` is sent verbatim. A user who deliberately includes leading/trailing whitespace in their password (some legacy systems require it) must not have it silently stripped.
- **Malformed input is silent**: AC-178-04 requires no toast / role="alert" / role="status" addition for malformed URL-shaped pastes. The existing URL-mode "Invalid URL" message at `ConnectionDialog.tsx:386-390` is part of the URL-mode path and stays there; the form-mode host field's malformed-URL response is "leave the value alone, no message."
- **`paradigm` mapping preserved**: the new schemes route to their existing paradigm via `paradigmOf`: `mongodb+srv → "document"`, `mariadb → "rdb"`. The paradigm field on `ConnectionDraft` continues to be required.
- **`parseConnectionUrl` return shape preserved**: same `Partial<ConnectionDraft> | null` contract; existing callers (`ConnectionDialog.tsx:401`, any other consumers found by `grep -r 'parseConnectionUrl' src/`) get richer schemes for free without API change.
- **`DATABASE_DEFAULTS` / `DATABASE_DEFAULT_FIELDS` unchanged**: no new `DatabaseType` variants are added in this sprint. `mongodb+srv` and `mariadb` are *URL-scheme aliases*, not new database types — they map to existing `DatabaseType` values so the rest of the app (form rendering, backend handler dispatch) is untouched.
- **Skip-zero gate holds** (AC-GLOBAL-05): no `it.skip` / `it.todo` / `xit` introduced.
- **Strict TS** (AC-GLOBAL-01 lint gate): no `any`; no `console.log` in production paths.
- **No new runtime dependencies**; no `package.json` change.

## Acceptance Criteria

- `AC-178-01` — Pasting a URL of any of the 8 recognized schemes (`postgres`, `postgresql`, `mysql`, `mongodb`, `mongodb+srv`, `mariadb`, `redis`, `sqlite:` file URL) into the form-mode host field populates `db_type`, `host`, `port`, `user`, `database`, and `password` (where present) in one step, and a non-modal "detected" affordance is shown.
- `AC-178-02` — `name`, `host`, `database`, `user`, `group_name` (if present in the draft) have leading/trailing whitespace stripped before save/test; `password` is sent verbatim.
- `AC-178-03` — `host:NNNN` blur splits the digit suffix into `port`; IPv6 inputs (`[::1]:5432`, `fe80::1`) leave host unchanged.
- `AC-178-04` — Malformed URL pastes (e.g. `postgres://`, `mysql://@`) leave the host field unchanged and add no error toast / no `role="alert"` / no `role="status"` region.
- `AC-178-05` — Password substring (raw or URL-encoded) is absent from every `role="alert"` / `role="status"` / `aria-live` region's `textContent` at every step of the paste / detect / save flow.

## Design Bar / Quality Bar

- **Detection trigger**: the form-mode host field detects a URL on `onPaste` (preferred — the user's intent is most explicit at paste time) OR on `onChange` if the value-shape detection is unambiguous (starts with `<scheme>://` or is the sqlite-file-URL form `sqlite:/`). The Generator picks one approach and documents it in `findings.md`. Either approach must be debounced or single-shot enough that typing a host like `db.example.com` does not trigger detection mid-stream.
- **Detection affordance**: the affordance must be non-modal and non-blocking. Acceptable shapes: an inline `<p>` or `<div>` near the host field with copy like "Detected `postgresql` URL — fields populated"; a toast via the existing toast surface if any; a transient banner above the form. Unacceptable: a modal dialog, a `role="alert"` that steals focus, a confirm-prompt asking the user to approve. The affordance must be reachable from the AC-178-01 test (i.e. the test can `getByText` or `getByRole` it after paste).
- **Trim location**: trim is applied at the save/test boundary (in `handleSave` and `handleTest` before the `ConnectionDraft` is built / dispatched), not on every keystroke. Reason: stripping on keystroke makes typing a leading space awkward (e.g. while pasting then editing). The `findings.md` records the chosen point.
- **Trim list**: the Generator declares an explicit, narrowly-scoped list of trimmed keys (`["name", "host", "database", "user", "group_name"]`) so future fields don't get accidentally stripped when added (e.g. `password`-like SSH key paths). The trim helper is a small pure function (e.g. `trimDraft(draft)`) so it is unit-testable independently.
- **Host:port split rule**: the split is triggered on `onBlur` of the host field. The detection rule: the value matches `^([^\[:][^:]*):(\d+)$` (single-colon, host part contains no `[`, port is digits-only). Anything that contains `[` (IPv6 bracket form) or has more than one `:` or has non-digit port is left untouched. The Generator MAY adjust the regex but must include test cases for the IPv6 forms listed in AC-178-03.
- **Malformed URL silence**: the form-mode paste handler treats a malformed URL the same way the existing `URL.parse` does — `parseConnectionUrl` returns `null`, the handler does nothing (no state change to host, no toast, no alert region added). The user's pasted text remains in the host field exactly as typed/pasted.
- **Password leak guard**: every `setError(...)`, `setUrlError(...)`, `setTestResult({status:"error", message: ...})` call site reachable from the form-mode paste / save / test path is audited. If any of those sources can include the password substring (e.g. backend error echoing the connection string), the message is sanitized before set. The Generator records the audit list in `findings.md`.
- **Tests use user-visible queries** (`getByRole`, `getByLabelText`, `getByText`) first; `container.querySelector` only when the assertion is class-level (sprint-178 has none of those — all assertions are on form values, presence/absence of alert nodes, and `textContent` containment).
- **Each new test gets a Reason + date comment** per the user's auto-memory `feedback_test_documentation.md` (2026-04-28), e.g. `// AC-178-01 — paste of postgres URL populates form in one step; date 2026-04-30.`
- **Coverage**: ≥ 70% line coverage on touched files (project convention; AC-GLOBAL-04). `connection.ts` is small (~285 lines); `ConnectionDialog.tsx` is large (~630 lines) but the sprint touches only the form-mode host handlers + save handler, so coverage is measured on the touched lines, not the whole file.
- **Visual direction**: the affordance is a calm, secondary signal — not destructive in tone, not flashy. Suggested copy: `Detected <scheme> URL — fields populated.` Single sentence, neutral foreground/muted-foreground tone matching the existing `.text-2xs.text-muted-foreground` paragraph at `ConnectionDialog.tsx:379-382`.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/types/connection.test.ts src/components/connection/` — runs the parser test extensions, the ConnectionDialog tests (existing + new AC-178 cases), and any other connection-area tests. Must be green; AC-178-01..05 covered by AC-tagged tests with `[AC-178-0X]` prefix in test names.
2. `pnpm vitest run` — full Vitest suite. Must be green (no regression). Watch for downstream consumers of `parseConnectionUrl` (none expected; verified during contract drafting via grep — only `ConnectionDialog.tsx:401` consumes the helper).
3. `pnpm tsc --noEmit` — strict-mode type check. Zero errors.
4. `pnpm lint` — ESLint. Zero errors.
5. Static (Generator-recorded, Evaluator re-runs): file inspection of `parseConnectionUrl` in `src/types/connection.ts` confirms the scheme map at lines 212–218 enumerates all eight schemes (`postgresql`, `postgres`, `mysql`, `mariadb`, `mongodb`, `mongodb+srv`, `redis`) plus the `sqlite:` branch above it. Command: `grep -n -E '"postgres|"mysql|"mariadb|"mongodb|"redis|sqlite:' src/types/connection.ts`.
6. Browser smoke (operator-driven step list — Generator records observation, Evaluator re-runs):
   1. `pnpm tauri dev`.
   2. Open `New Connection` dialog (form mode).
   3. Paste `postgres://u:p@h:1234/db` into the host field.
   4. Confirm `db_type`, `host`, `port`, `user`, `database` populate in one step (no extra click) and the "detected" affordance shows.
   5. Paste `mongodb+srv://user:secret@cluster.example.com/mydb` — confirm the host field accepts the SRV hostname as-is (no port populated since SRV has no port), `db_type` becomes `mongodb`.
   6. Type `localhost:5433` into the host field, blur — confirm split into host `localhost` + port `5433`.
   7. Type `[::1]:5432` into the host field, blur — confirm host stays `[::1]:5432` (no split).
   8. Save a connection with `name = "  My DB  "` and `host = "  localhost  "` — confirm the saved connection (re-open the dialog or inspect via the Sidebar) shows trimmed values.

### Required Evidence

- Generator must provide:
  - Changed files (full list with one-line purpose each — at minimum: `connection.ts`, `connection.test.ts`, `ConnectionDialog.tsx`, `ConnectionDialog.test.tsx`, `findings.md`, `handoff.md`).
  - Vitest output for the new + touched tests, including AC IDs each test covers (a `[AC-178-0X]` prefix in the test name is acceptable).
  - For AC-178-01: explicit test rows for each of the 8 schemes asserting form state populated AND the affordance present.
  - For AC-178-02: a payload-shape assertion on the outgoing `addConnection` / `updateConnection` / `testConnection` mock invocation showing trimmed values for `name`, `host`, `database`, `user`, `group_name`-if-present and verbatim password (e.g. `password: "  pad  "` survives).
  - For AC-178-03: tests for `localhost:5433` (must split), `[::1]:5432` (must not split), `fe80::1` (must not split), `db.example.com:not-a-port` (must not split — non-digit port).
  - For AC-178-04: tests for `postgres://`, `mysql://@`, `mongodb://` and `mariadb://` asserting host field unchanged AND no `role="alert"` / `role="status"` element appears as a result of the paste.
  - For AC-178-05: a test that pastes `postgres://u:pass123ZZ@h/db`, then walks every `role="alert"` and `role="status"` region in the DOM and asserts none of their `textContent` contains the substring `pass123ZZ`. Also an inverse test that triggers a save error (mock `addConnection` to reject with `Error("connection refused at postgres://u:pass123ZZ@h/db")`) and asserts the rendered error message does NOT contain `pass123ZZ` (the message is sanitized before display).
  - `findings.md` containing: mechanism note (paste vs change trigger, trim location, host:port split regex, affordance shape), audit list of error-display call sites with their sanitization treatment, browser smoke summary, evidence index.
- Evaluator must cite:
  - Concrete evidence for each AC pass/fail (test name + assertion text or screenshot path).
  - Re-run of `pnpm vitest run src/types/connection.test.ts src/components/connection/` showing AC-tagged cases pass.
  - Re-run of the static check confirming the `parseConnectionUrl` scheme map enumerates all eight scheme strings.
  - Confirmation that no `it.skip` / `it.todo` / `xit` was introduced in the touched test files (`grep -n -E 'it\.(skip|todo)|xit\(' src/types/connection.test.ts src/components/connection/ConnectionDialog.test.tsx` returns empty).
  - Confirmation that `password` field is excluded from the trim list (search the trim helper or trim call site for the literal `"password"` — must NOT appear).
  - Any missing or weak evidence (e.g. AC-178-05 claimed without an inverse save-error sanitization test) flagged as a P2 finding.

## Test Requirements

### Unit Tests (필수)

Each AC gets at least one Vitest scenario. Tests live in two files:

- `src/types/connection.test.ts` — parser-level tests for the new schemes and edge cases.
- `src/components/connection/ConnectionDialog.test.tsx` — UI-level tests for paste / trim / blur split / malformed silence / password leak guard.

Each new test carries a Reason + date comment per the 2026-04-28 feedback rule.

- **`connection.test.ts` extensions**:
  - `mongodb+srv` URL parses: `db_type === "mongodb"`, `paradigm === "document"`, `host` preserved as the SRV cluster hostname, `port` falls back to the mongodb default (since SRV URLs typically omit port).
  - `mariadb` URL parses: `db_type === "mysql"`, `paradigm === "rdb"`, `host`/`port`/`user`/`password`/`database` populated.
  - URL-encoded password survives through `parseConnectionUrl` for the new schemes (regression coverage for the existing `decodeURIComponent` behavior).
  - Malformed inputs (`postgres://`, `mysql://@`, `mongodb+srv://`, `mariadb://@/`) return `null` (no throw) — this is the contract the UI relies on for AC-178-04.
  - IPv6-in-URL (`postgres://[::1]:5432/db`) parses and the host comes back without bracket stripping issues — guard against the parser corrupting bracketed hosts.

- **`ConnectionDialog.test.tsx` extensions** (one test per AC, plus the password-leak inverse case):
  - `[AC-178-01] pasting <scheme>://...` — table-driven across all 8 schemes; for each: render dialog in form mode, paste the URL into the host field, assert form state has expected `db_type`/`host`/`port`/`user`/`database`/(password where present) AND the "detected" affordance is in the DOM. Reason comment: `// AC-178-01 — paste of <scheme> URL populates form in one step; date 2026-04-30.`
  - `[AC-178-02] save handler trims string fields` — render dialog, type whitespace-padded values into `name` ("  My DB  "), `host` ("  localhost  "), `database` ("  testdb  "), `user` ("  admin  "), and a password with leading/trailing spaces ("  secret  "). Click Save. Assert the mock `addConnection` was called once with `name: "My DB"`, `host: "localhost"`, `database: "testdb"`, `user: "admin"`, `password: "  secret  "` (verbatim).
  - `[AC-178-03a] host:port blur splits` — type `localhost:5433` into host, blur, assert host = `localhost`, port = `5433`.
  - `[AC-178-03b] IPv6 input does not split` — type `[::1]:5432`, blur, assert host = `[::1]:5432`, port unchanged from default.
  - `[AC-178-03c] non-digit port does not split` — type `db.example.com:abcd`, blur, assert host unchanged.
  - `[AC-178-04] malformed URL paste is silent` — paste `postgres://`, assert host field still contains `postgres://` AND `screen.queryAllByRole("alert").length` AND `screen.queryAllByRole("status").length` are not increased relative to baseline (capture baseline before paste).
  - `[AC-178-05a] password substring not in alerts after paste` — paste `postgres://u:pass123ZZ@h/db`, walk all `role="alert"` / `role="status"` nodes, assert none contain `pass123ZZ`. Also assert URL-encoded variant `pass%31%32%33ZZ` (or the actual encoded form) is absent.
  - `[AC-178-05b] password substring not in save error` — paste the URL, click Save with a mocked `addConnection` rejection whose message naively echoes the connection string `Error: connection refused at postgres://u:pass123ZZ@h/db`. Assert the rendered error region (the existing `<div role="alert">` at `ConnectionDialog.tsx:583-590`) does NOT contain `pass123ZZ`.

- **Existing-test impact**: the existing `ConnectionDialog.test.tsx` covers the URL-mode toggle path and the form-mode field rendering. No matchers are expected to break (the trim is a save-time transform; existing tests that read form state mid-edit see un-trimmed values). The Generator confirms by running the existing file unmodified first; if any test does break, the rationale and the rewrite go into `findings.md`.

### Coverage Target

- 신규/수정 코드: 라인 70% 이상 (AC-GLOBAL-04, project convention).
- CI 전체 기준: 라인 40%, 함수 40%, 브랜치 35%.

### Scenario Tests (필수)

- [x] Happy path — paste of each of the 8 recognized schemes populates form in one step (AC-178-01).
- [x] 에러/예외 — malformed URL paste leaves host unchanged with no error region (AC-178-04); save-error path does not leak password substring (AC-178-05b).
- [x] 경계 조건 — IPv6 inputs do not trigger host:port split (AC-178-03b/c); whitespace-only edits to non-trimmed fields (e.g. `password = "  "`) survive verbatim (AC-178-02 invariant); empty paste (`""`) is a no-op.
- [x] 기존 기능 회귀 없음 — URL-mode toggle path, `Parse & Continue` button, password input flow (`null` / `""` / non-empty semantics), `pendingDbTypeChange` confirm dialog, environment select all keep working (existing tests in `ConnectionDialog.test.tsx` pass without modification).

## Test Script / Repro Script

Manual replay for the Evaluator:

1. `pnpm install` (if not already).
2. `pnpm vitest run src/types/connection.test.ts src/components/connection/` — confirm all `[AC-178-0X]` cases pass; confirm parser-level new-scheme tests pass.
3. `pnpm vitest run` — confirm full suite still green.
4. `pnpm tsc --noEmit` — zero errors.
5. `pnpm lint` — zero errors.
6. `grep -n -E '"postgres|"mysql|"mariadb|"mongodb|"redis|sqlite:' src/types/connection.ts` — confirm the scheme map enumerates all eight schemes.
7. `grep -n -E 'it\.(skip|todo)|xit\(' src/types/connection.test.ts src/components/connection/ConnectionDialog.test.tsx` — confirm empty (skip-zero gate).
8. `grep -n '"password"' <trim-helper-file-or-call-site>` — confirm `password` is NOT in the trim list.
9. `pnpm tauri dev`, follow the browser smoke step list in Verification Plan §Required Checks #6.
10. Open `docs/sprints/sprint-178/findings.md` — confirm sections: mechanism note (paste vs change trigger, trim location, host:port split rule, affordance shape), error-display sanitization audit, browser smoke summary, evidence index.

## Ownership

- Generator: single agent (one Generator role within the harness).
- Write scope:
  - `src/components/connection/ConnectionDialog.tsx`
  - `src/components/connection/ConnectionDialog.test.tsx` (extend existing file)
  - `src/types/connection.ts`
  - `src/types/connection.test.ts` (extend existing file)
  - `docs/sprints/sprint-178/findings.md` (new)
  - `docs/sprints/sprint-178/handoff.md` (sprint deliverable; standard harness output)
  - Optionally, if the Generator chooses extraction over in-place extension (per spec §C.6 / discrepancy): a new `src/lib/connection/urlParser.ts` (or similar) plus its sibling test file. Either path is acceptable; the chosen path is documented in `findings.md`.
- Untouched: `memory/`, `CLAUDE.md`, `src-tauri/`, `src/stores/connectionStore.ts` (the IPC consumer is not modified — only the payload it receives is normalized), `src/components/connection/forms/*` (DBMS-specific sub-components remain unchanged), sprints 176 / 177 / 179 / 180 spec/contract/brief, any file outside the write scope above.
- Merge order: this sprint is independent of 176 / 177 (already merged or independent). Sprints 179 / 180 do not depend on this one. Land any time after 177.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1–6 in Verification Plan)
- `docs/sprints/sprint-178/findings.md` exists and includes the mechanism note + sanitization audit + browser smoke evidence.
- Acceptance criteria evidence linked in `docs/sprints/sprint-178/handoff.md` (one row per AC pointing to the test or evidence file).
