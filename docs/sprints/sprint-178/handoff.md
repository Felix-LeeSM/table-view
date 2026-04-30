# Sprint 178 — Generator Handoff

Generator: single-agent run, 2026-04-30. Sprint applies Postel's Law to
`ConnectionDialog` form-mode input: paste-detection for 8 URL schemes,
save/test-time trim of non-password string fields, `host:NNNN` blur
split, silent absorption of malformed URL pastes, and a password-leak
guard on every dynamic alert/status/aria-live region.

## Changed files

| File | Status | Purpose (one line) |
|---|---|---|
| `src/types/connection.ts` | modified | Extend `parseConnectionUrl` scheme map with `mariadb` + `mongodb+srv`; tighten empty-host return to `null`. |
| `src/types/connection.test.ts` | modified | +11 parser tests for new schemes, encoded passwords, IPv6 brackets, malformed URLs, host:port-only rejection. |
| `src/components/connection/ConnectionDialog.tsx` | modified | Module-scope `sanitizeMessage`; `trimDraft` helper; `handleHostPaste` / `handleHostBlur` delegated on form wrapper; `detectedScheme` state + inline affordance; save/test catch routed through `sanitizeMessage`. |
| `src/components/connection/ConnectionDialog.sprint178.test.tsx` | new | +24 UI tests (table-driven across 8 schemes for AC-178-01; trim payload assertion for AC-178-02; 4 split decision rows for AC-178-03; 4 malformed silence rows for AC-178-04; 4 password-leak guards for AC-178-05). |
| `docs/sprints/sprint-178/findings.md` | new | Generator notes: mechanism, sanitisation audit, browser smoke summary, evidence index, residual risks. |
| `docs/sprints/sprint-178/handoff.md` | new | This file. |

## Checks run

| Command | Outcome |
|---|---|
| `pnpm vitest run src/types/connection.test.ts src/components/connection/ConnectionDialog.sprint178.test.tsx` | 2 files / 57 tests pass (33 parser + 24 sprint-178 UI). |
| `pnpm vitest run src/types/connection.test.ts src/components/connection/` | All connection-area tests green (sprint-178 + 69 existing ConnectionDialog tests + neighbours = 341 tests). |
| `pnpm vitest run` (full suite) | Green except the pre-existing `window-lifecycle.ac141.test.tsx:173` failure documented in execution-brief as out-of-scope. |
| `pnpm tsc --noEmit` | Zero errors. |
| `pnpm lint` | Zero errors. |
| `grep -n -E '"postgres\|"mysql\|"mariadb\|"mongodb\|"redis\|sqlite:' src/types/connection.ts` | All 8 schemes enumerated (lines 200, 220–226). |
| `grep -n -E 'it\.(skip\|todo)\|xit\(' src/types/connection.test.ts src/components/connection/ConnectionDialog.sprint178.test.tsx` | Empty (skip-zero gate holds). |
| `grep -n '"password"' src/components/connection/ConnectionDialog.tsx` | Empty for the trim list — `password` is excluded by construction. |

Browser smoke is operator-driven per the contract's mixed verification
profile; the Generator did not launch `pnpm tauri dev`. Replay steps for
the Evaluator are listed in `findings.md → Browser smoke summary`.

## Done-criteria coverage

| AC | Test file | Test name | Notes |
|---|---|---|---|
| AC-178-01 | `ConnectionDialog.sprint178.test.tsx` | `[AC-178-01] form-mode host paste detection › paste of <scheme> URL populates form in one step + shows affordance` (table-driven, 8 rows) | One row per scheme: postgres, postgresql, mysql, mariadb, mongodb, mongodb+srv, redis, sqlite. Asserts `db_type`, `host`, `port`, `user`, `database`, password (where present), and presence of `[data-testid="connection-url-detected"]`. |
| AC-178-01 | `connection.test.ts` | `parses mongodb+srv URL …`, `parses mariadb URL …`, `decodes URL-encoded password for mongodb+srv`, `decodes URL-encoded password for mariadb`, `returns null for unrecognised scheme like cockroachdb://` | Parser-leg coverage for new schemes + encoded-password regression. |
| AC-178-01 | `ConnectionDialog.sprint178.test.tsx` | `empty paste is a no-op` | Empty clipboard payload leaves form state unchanged. |
| AC-178-02 | `ConnectionDialog.sprint178.test.tsx` | `[AC-178-02] save-time trim of non-password string fields › trims name / host / database / user; password sent verbatim` | Asserts mock `addConnection` invocation receives trimmed `name`/`host`/`user`/`database` and verbatim padded password. |
| AC-178-02 | `ConnectionDialog.sprint178.test.tsx` | `[AC-178-02] trim also applies on Test Connection` | Asserts mock `testConnection` invocation receives same trimmed fields. |
| AC-178-03 | `ConnectionDialog.sprint178.test.tsx` | `[AC-178-03a] localhost:5433 splits to host=localhost + port=5433` | Single-colon IPv4-shaped host:port path. |
| AC-178-03 | `ConnectionDialog.sprint178.test.tsx` | `[AC-178-03b] [::1]:5432 stays untouched (bracketed IPv6)` | First-char `[` rejection. |
| AC-178-03 | `ConnectionDialog.sprint178.test.tsx` | `[AC-178-03b] fe80::1 stays untouched (bare IPv6, multiple colons)` | Multi-colon rejection. |
| AC-178-03 | `ConnectionDialog.sprint178.test.tsx` | `[AC-178-03c] db.example.com:abcd stays untouched (non-digit port)` | Non-digit suffix rejection. |
| AC-178-04 | `ConnectionDialog.sprint178.test.tsx` | `[AC-178-04] malformed URL paste is silent › malformed paste "<url>" leaves host unchanged + adds no alert/status region` (4 rows: `postgres://`, `mysql://@`, `mongodb://`, `mariadb://`) | Captures alert/status counts before paste, asserts identical counts after. |
| AC-178-04 | `connection.test.ts` | `returns null for postgres:// (empty host)`, `returns null for mysql://@ (empty host with @)`, `returns null for mongodb+srv:// (empty host)`, `returns null for mariadb://@/ (empty host with trailing slash)`, `returns null for host:port-only input (not a URL)` | Parser contract that the UI relies on for AC-178-04. |
| AC-178-05 | `ConnectionDialog.sprint178.test.tsx` | `[AC-178-05a] password absent from all alerts after URL paste` | Walks every `[role="alert"]`, `[role="status"]`, `[aria-live]` node after pasting `postgres://u:pass123ZZ@h/db`, asserts `pass123ZZ` substring absent from each `textContent`. |
| AC-178-05 | `ConnectionDialog.sprint178.test.tsx` | `[AC-178-05b] password absent from test-feedback after backend echoes connection string` | Mocks `testConnection` to reject with `Error("connection refused at postgres://u:pass123ZZ@h/db")`; asserts test-feedback aria-live region replaces the substring with `***`. |
| AC-178-05 | `ConnectionDialog.sprint178.test.tsx` | `[AC-178-05b] password absent from save-error alert after backend echoes connection string` | Mocks `addConnection` to reject with the same naive echo; asserts the `role="alert"` save-error region replaces the substring with `***`. |
| AC-178-05 | `ConnectionDialog.sprint178.test.tsx` | `[AC-178-05] URL-encoded password also masked in save-error alert` | Asserts both raw `p@ss!word` and its `encodeURIComponent` form `p%40ss%21word` are absent from the save-error region. |

Per-AC pass count: 5 of 5. Each AC has at least one Vitest scenario
with the `[AC-178-0X]` prefix in its test name; each new test carries a
Reason + date comment per the 2026-04-28 documentation feedback.

## Assumptions

1. **Paste over change as the detection trigger.** `onPaste` on the
   form wrapper is delegated to all child inputs via React synthetic
   event bubbling; the handler short-circuits when
   `target.id !== "conn-host"`. Justification in
   `findings.md → Mechanism notes → Detection trigger`.
2. **Trim helper inlined, not extracted.** `trimDraft` is a `const`
   inside `ConnectionDialog`. Promoting to `src/types/connection.ts`
   was deferred because there is no second consumer today.
3. **Affordance is a plain `<p>` (no role).** AC-178-04 forbids adding
   a `role="alert"`/`role="status"` for malformed pastes; AC-178-05
   walks every alert/status/aria-live region looking for password
   leaks. A neutral `<p>` is the only shape that satisfies both.
4. **`detectedScheme` is not auto-cleared on subsequent host edits.**
   Re-pasting another URL replaces the scheme; otherwise the advisory
   note remains visible. Stale-affordance is benign.
5. **`parseConnectionUrl` now returns `null` for empty hostname.**
   Previously fell back to `host: "localhost"`. The fallback was
   unsafe for the form-mode paste path; no existing caller depends on
   it (URL-mode `Parse & Continue` benefits from the tighter null
   semantic too).
6. **Browser smoke is operator-driven.** Generator did not run
   `pnpm tauri dev` — the contract's mixed verification profile assigns
   live smoke replay to the Evaluator. Replay steps in
   `findings.md → Browser smoke summary`.

## Residual risk

- **Live `mongodb+srv` end-to-end smoke** (DNS + reachable cluster)
  not exercised. Parser leg + form-population leg covered in unit
  tests; SRV resolution is a backend-driver concern with no frontend
  code change needed.
- **jsdom paste limitation.** jsdom does not implement default browser
  paste behaviour, so unit tests cannot directly assert "the literal
  URL did NOT land in the host field after a successful paste." The
  successful-paste branch calls `e.preventDefault()` before setting
  state from the parsed URL; tests instead assert that the resulting
  host equals the parsed host (e.g. `h`, not the literal pasted URL).
  Browser smoke covers `preventDefault` in real browsers.
- **Pre-existing failure** in `window-lifecycle.ac141.test.tsx:173`
  unrelated to sprint 178 (documented as out-of-scope in
  execution-brief). Not introduced by these changes.

## Pointers

- Spec/contract: `docs/sprints/sprint-178/contract.md`
- Generator notes (mechanism + sanitisation audit + smoke + evidence
  index + per-scheme paste table + per-rule split decision table +
  alert-walk procedure): `docs/sprints/sprint-178/findings.md`
- Test files: `src/types/connection.test.ts:114-214`,
  `src/components/connection/ConnectionDialog.sprint178.test.tsx`
- Source files: `src/types/connection.ts:212-235`,
  `src/components/connection/ConnectionDialog.tsx:95` (sanitizeMessage),
  `172` (detectedScheme state), `256` (trimDraft),
  `345-414` (RECOGNISED_SCHEMES + paste/blur handlers + HOST_PORT_RE),
  `607-608` (form-wrapper onPaste/onBlur delegation),
  `699-705` (affordance JSX).
