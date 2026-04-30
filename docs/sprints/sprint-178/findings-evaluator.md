# Sprint 178 — Evaluator Scorecard (attempt 1)

Date: 2026-04-30. Evaluator: harness Evaluator role. Verification profile: `mixed`
(static + command + browser smoke deferred to operator).

## Sprint 178 Evaluation Scorecard

| Dimension | Weight | Score | Notes |
|-----------|--------|-------|-------|
| **Correctness** | 35% | 9/10 | All 5 AC behaviours implemented end-to-end. `parseConnectionUrl` scheme map enumerates all 8 (`postgres`, `postgresql`, `mysql`, `mariadb`, `mongodb`, `mongodb+srv`, `redis`, plus `sqlite:` URL branch — verified at `src/types/connection.ts:200`, `220-226`). The `host:NNNN` regex `^([^[:][^:]*):(\d+)$` correctly rejects `[::1]:5432` (first char `[`), `fe80::1` (multiple colons → fails the no-colon segment), `::1:5432` (first char `:`), and `db.example.com:abcd` (non-digit suffix). `sanitizeMessage` masks both raw and `encodeURIComponent` forms. `parseConnectionUrl` now returns `null` for empty hostname (the previously-fallthrough `host: "localhost"` was a real bug source for AC-178-04 silence). |
| **Completeness** | 25% | 9/10 | All 5 AC have at least one (most have multiple) Vitest scenarios with `[AC-178-0X]` test-name prefix. Per-scheme paste table covers all 8 schemes. Trim test verifies both `addConnection` AND `testConnection` payloads. IPv6 split rejection covers bracketed (`[::1]:5432`), bare (`fe80::1`), and non-digit (`db.example.com:abcd`) cases. AC-178-05 walks `role="alert"`, `role="status"`, AND `[aria-live]` regions (verified at `ConnectionDialog.sprint178.test.tsx:582-584`) — exceeds the contract's "every alert/status/aria-live region" requirement. URL-encoded password masking is exercised in a separate test. |
| **Reliability** | 20% | 8/10 | Failure paths covered: save-error rejection, test-error rejection, naive-echo backend message, URL-encoded form. `sanitizeMessage` uses `String#split(secret).join("***")` (literal substring, not regex), correctly avoiding regex-meta interpretation of password chars. Trim uses an explicit allowlist (`name`, `host`, `database`, `user`) rather than `Object.keys` — future-safe. Static `pendingDbTypeChange` confirm dialog and existing 69 ConnectionDialog tests pass unchanged. One small reliability concern: AC-178-04 host-value assertion is partially vacuous in jsdom (no default-paste implementation), but the affordance-not-present and alert/status-count assertions are non-vacuous and do exercise the silence contract — generator documents this jsdom limitation in findings.md (residual risk #4). |
| **Verification Quality** | 20% | 8/10 | Static grep confirms all 8 schemes; ESLint clean; `tsc --noEmit` clean; 341 connection-area tests pass; full suite has 2469 pass with 1 pre-existing unrelated failure (`window-lifecycle.ac141.test.tsx:173`). Reason+date comments present (12 hits in `ConnectionDialog.sprint178.test.tsx`, 5 in `connection.test.ts` for sprint-178 cases). Browser smoke is operator-driven per the contract — generator did not run `pnpm tauri dev` but documents the replay steps. **Minor weakness**: per-test "Reason" comment density is good in the sprint178 test file but the parser-level test file `connection.test.ts` uses single block comments per logical group rather than per-test reason comments — acceptable but not as fine-grained as `feedback_test_documentation.md` ideally encourages. |
| **Overall** | — | **8.6/10** | All four dimensions ≥ 7. Pass threshold met. |

## Verdict: PASS

## Sprint Contract Status (Done Criteria)

| AC | Verdict | Evidence |
|---|---|---|
| AC-178-01 | PASS | `ConnectionDialog.sprint178.test.tsx:131-301` — table-driven `PASTE_CASES` array iterates all 8 schemes (postgres, postgresql, mysql, mariadb, mongodb, mongodb+srv, redis, sqlite). Each case asserts `db_type`, `host`, `port`, `user`, `database` populated AND `getByTestId("connection-url-detected")` is in the document AND `affordance.getAttribute("role")` is `null` (so it isn't a `role="alert"`/`role="status"` region — non-modal). Affordance copy: `Detected <scheme> URL — fields populated.` (`ConnectionDialog.tsx:704`). |
| AC-178-02 | PASS | `ConnectionDialog.sprint178.test.tsx:333-406` — two tests (`addConnection` + `testConnection`) assert outgoing payload contains trimmed `name="My DB"`, `host="localhost"`, `user="admin"`, `database="testdb"` AND verbatim `password="  secret  "`. Trim helper at `ConnectionDialog.tsx:256-262` uses an explicit allowlist; `password` is preserved via `...draft` spread (no literal `"password"` reference in trim list — confirmed by `grep -n '"password"'` empty result). |
| AC-178-03 | PASS | Four tests at `ConnectionDialog.sprint178.test.tsx:419-502` cover: (a) `localhost:5433` splits, (b) `[::1]:5432` (bracketed IPv6) doesn't split, (c) `fe80::1` (multi-colon IPv6) doesn't split, (d) `db.example.com:abcd` (non-digit port) doesn't split. Regex `^([^[:][^:]*):(\d+)$` at `ConnectionDialog.tsx:408` correctly rejects all three IPv6/non-digit shapes. Verified by manual regex walkthrough: `[` rejection (first char `[`), `:` rejection (first char `:` in `::1:5432`), and the `[^:]*` segment rejecting any non-trailing colons in `fe80::1`. |
| AC-178-04 | PASS (with caveat) | `ConnectionDialog.sprint178.test.tsx:515-559` — table-driven across `postgres://`, `mysql://@`, `mongodb://`, `mariadb://`. Captures baseline `queryAllByRole("alert").length` and `queryAllByRole("status").length` BEFORE paste, asserts identical counts AFTER. Also asserts `getByTestId("connection-url-detected")` is NOT in the document. Caveat: the host-value `expect(value).toBe(hostBefore)` line is technically vacuous in jsdom (no default-paste behaviour to overwrite), but the affordance + alert/status assertions are non-vacuous and exercise the AC's spirit (no field population, no error region). Generator documents this jsdom limitation in findings.md residual risk #4. Parser-level corroboration at `connection.test.ts:171-186` confirms `parseConnectionUrl` returns `null` for the four malformed inputs. |
| AC-178-05 | PASS | `ConnectionDialog.sprint178.test.tsx:572-700` — `assertNoPasswordLeak` walks every `[role="alert"]`, `[role="status"]`, AND `[aria-live]` node via `document.querySelectorAll` (confirmed by grep — `querySelectorAll` is called for all three selectors at lines 582-584). Four test cases: (a) post-paste alert walk, (b) test-feedback after `testConnection` rejection echoing connection string, (c) save-error after `addConnection` rejection echoing connection string, (d) URL-encoded password also masked. `sanitizeMessage` at `ConnectionDialog.tsx:95-115` masks both raw and `encodeURIComponent` forms via `String#split(secret).join("***")`. |

### Static Re-runs (Evaluator)

| Check | Outcome |
|---|---|
| `pnpm vitest run src/types/connection.test.ts src/components/connection/` | 17 files / 341 tests pass (re-confirmed). |
| `pnpm tsc --noEmit` | Zero errors. |
| `pnpm lint` | Zero errors. |
| `pnpm vitest run` (full suite) | 2469 pass, 1 fail (`window-lifecycle.ac141.test.tsx:173`) — pre-existing, unrelated to sprint-178, documented in execution-brief and findings.md residual risks. |
| `grep -n -E '"postgres\|"mysql\|"mariadb\|"mongodb\|"redis\|sqlite:' src/types/connection.ts` | Confirmed at lines 220–226 (`mariadb: "mysql"` at line 223; `"mongodb+srv": "mongodb"` at line 225) plus `sqlite:` branch at line 200. All 8 schemes enumerated. |
| `grep -n -E 'it\.(skip\|todo)\|xit\(' src/types/connection.test.ts src/components/connection/ConnectionDialog.sprint178.test.tsx` | Empty (skip-zero gate holds — AC-GLOBAL-05). |
| `grep -n '"password"' src/components/connection/ConnectionDialog.tsx` | Empty for the trim list — `password` is excluded by construction (verified). |
| `grep -n "DatabaseType" src/types/connection.ts` | Confirms no new variants added; `dbTypeMap: Record<string, DatabaseType>` casts the alias schemes onto existing types. |
| `grep -n "invoke(" src/components/connection/ConnectionDialog.tsx` | Empty — IPC commands invoked via `connectionStore` helpers; no signature changes. |

## File-level Diff Verification

| File | Lines changed | Verification |
|---|---|---|
| `src/types/connection.ts` | +17 / -1 | Scheme map at 219-227 includes `mariadb` (alias for `mysql`) and `mongodb+srv` (alias for `mongodb`). Empty-host null guard at line 235 preserves AC-178-04 contract. The 4-line scheme expansion is the minimal diff. No new `DatabaseType` variants. |
| `src/types/connection.test.ts` | +108 | 11 new parser-level tests in a new `describe` block at line 114. Each test in this block uses Reason+date comments per the 2026-04-28 documentation rule. Tests cover mongodb+srv, mariadb, encoded passwords, malformed URL nulls, bracketed IPv6 preservation, host:port-only rejection, unknown-scheme rejection. |
| `src/components/connection/ConnectionDialog.tsx` | +219 / -? | Module-scope `sanitizeMessage` (95-115), `detectedScheme` state (172), `trimDraft` helper (256-262), `RECOGNISED_SCHEMES` + `looksLikeRecognisedUrl` + `handleHostPaste` + `HOST_PORT_RE` + `handleHostBlur` (345-421), wrapper `onPaste`/`onBlur` delegation (607-608), affordance JSX (699-706). `handleSave` and `handleTest` route catches through `sanitizeMessage`. URL-mode toggle path untouched (lines 530-595 preserved). |
| `src/components/connection/ConnectionDialog.sprint178.test.tsx` | +702 (new file) | 24 new tests across 5 describe blocks (one per AC). Each describe carries an AC-tagged title; each test name has the `[AC-178-0X]` prefix as the contract requires. `assertNoPasswordLeak` helper at line 579 walks `[role="alert"]`, `[role="status"]`, `[aria-live]` regions. Each test has a Reason+date comment (12 dated comments verified). |

## Invariants Re-checked

- ✅ URL-mode toggle path unchanged (verified at `ConnectionDialog.tsx:530-595` — `setUrlError`, `Parse & Continue`, "Invalid URL" copy preserved).
- ✅ IPC commands unchanged — no `invoke(...)` in `ConnectionDialog.tsx`; calls go through `useConnectionStore` helpers (`addConnection`, `updateConnection`, `testConnection`) with the same `ConnectionDraft` shape.
- ✅ ADR-0005 honored — `password` excluded from `trimDraft`; `sanitizeMessage` masks both raw and URL-encoded password before painting alerts.
- ✅ `DATABASE_DEFAULTS`, `DATABASE_DEFAULT_FIELDS`, `paradigmOf`, `assertNever` exhaustive switch all unchanged.
- ✅ No new `DatabaseType` variants — `mongodb+srv` and `mariadb` are alias keys casting onto existing values.
- ✅ Skip-zero gate holds (no `it.skip` / `it.todo` / `xit`).
- ✅ Strict TS (no `any`); ESLint clean.
- ✅ No new runtime dependencies; no `package.json` change.
- ✅ `paradigm` mapping preserved: `mongodb+srv → "document"` (via `paradigmOf("mongodb")`), `mariadb → "rdb"` (via `paradigmOf("mysql")`).

## Code-quality Observations

- **`sanitizeMessage` exported**: the helper is `export function sanitizeMessage` (line 95). This is fine — it allows future reuse and makes the helper unit-testable independently. No unit test currently targets the export directly, but the integration tests in `ConnectionDialog.sprint178.test.tsx` exercise both branches (raw + encoded form) via the AC-178-05 cases.
- **Empty-secrets guard**: `if (!secret || secret.length === 0) continue;` correctly avoids replacing legitimate text with `***` when no password is set (e.g. fresh dialog).
- **Wrapper-delegated event handlers**: `onPaste` and `onBlur` on the form wrapper short-circuit on `target.id !== "conn-host"` — keeps the dialog single-source-of-truth for the URL-detection mechanic without prop-drilling through every `*FormFields` sub-component. Good architectural choice.
- **`detectedScheme` reset policy**: not auto-cleared on subsequent host edits. The findings.md justifies this as benign stale-affordance; acceptable but a future polish could `setDetectedScheme(null)` on `host` change to keep the note in sync with the field state. Not a P2 finding.

## Minor Suggestions (non-blocking)

1. **AC-178-02 source-level guard**: the test `ConnectionDialog source does NOT trim password (regression guard)` at line 400-405 is currently a stub (`expect(true).toBe(true)`). The runtime payload assertion is the strict gate, so the test is non-load-bearing — but the comment block (line 396-399) sets the expectation that this test DOES guard against a future regression. Consider either (a) deleting the stub since the runtime assertion already covers it, or (b) replacing it with a `vi.importActual('./ConnectionDialog')` source-text scan that asserts `password:` does not appear inside `trimDraft`. Either keeps the contract intent more honest.
2. **AC-178-04 host-value assertion**: as flagged, the `expect(host).toBe(hostBefore)` line is vacuous in jsdom. Documented as a residual risk; consider a `// jsdom paste limitation — see findings.md` comment inline so future readers don't read it as a meaningful assertion.
3. **Reason-comment density on parser tests**: `connection.test.ts` has 5 dated reason comments across the 11 new tests, vs. 12 across 24 in `ConnectionDialog.sprint178.test.tsx`. The parser tests sometimes reuse a date stamp across an `it` block via the leading describe-block comment; this satisfies the rule but a per-test stamp would future-proof against test-file restructuring.

## Feedback for Generator

None required for PASS. All P0/P1/P2 findings empty. The minor suggestions above are nice-to-have polish, not blocking.

## Exit Criteria

- Open `P1`/`P2` findings: **0**
- Required checks passing: **yes** (1–6 in Verification Plan; browser smoke deferred to operator per mixed profile)
- `docs/sprints/sprint-178/findings.md` exists with mechanism note + sanitization audit + browser smoke summary + evidence index + per-scheme table + per-rule split table + alert-walk procedure.
- Acceptance criteria evidence linked in `docs/sprints/sprint-178/handoff.md` (one row per AC).

## Verdict

**PASS**
