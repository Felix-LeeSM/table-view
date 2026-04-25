# Handoff: sprint-108 — ConnectionDialog DB type port guard (#CONN-DIALOG-2)

## Outcome

- Status: PASS
- Summary: ConnectionDialog now guards a user-customised port when the DB
  type changes. Default-or-empty ports keep the legacy auto-update behaviour.
  Custom ports defer the swap and surface a sprint-95 `ConfirmDialog` preset
  that asks the user to either accept the new default or cancel and keep
  their port. paradigm continues to track dbType through the shared
  `applyDbTypeChange` helper. Five new tests added (one per AC-01..AC-05);
  full suite green.

## Verification Profile

- Profile: command
- Overall score: 9.0/10
- Final evaluator verdict: PASS

## Evidence Packet

### Checks Run

- `pnpm vitest run`: pass — 1792/1792 across 103 files (was 1787 before
  sprint; +5 new tests, 0 regressions). Duration ~16.6s.
- `pnpm tsc --noEmit`: pass — no diagnostics.
- `pnpm lint`: pass — `eslint .` exits clean.

### Acceptance Criteria Coverage

- `AC-01` (default port + dbType change → auto-update, no modal):
  - Code: `ConnectionDialog.tsx:126-139` — `handleDbTypeChange` computes
    `isDefaultOrEmpty` from
    `currentPort === DATABASE_DEFAULTS[oldDbType] || currentPort === 0` and
    routes default ports through `applyDbTypeChange` immediately.
  - Test: `ConnectionDialog.test.tsx:1051-1074` — "auto-updates port when
    current port is the default (postgres 5432 → mysql 3306)" asserts
    `select.value === "mysql"`, port input value `"3306"`, and that
    `screen.queryByText("Replace custom port?")` is null.
- `AC-02` (empty / 0 port + dbType change → auto-update, no modal):
  - Code: same `isDefaultOrEmpty` branch (port === 0 case).
  - Test: `ConnectionDialog.test.tsx:1076-1102` — "auto-updates port when
    current port is 0 (sqlite default → mysql)" first switches to sqlite
    (port → 0), then to mysql (port → 3306) without surfacing the modal.
- `AC-03` (custom port + dbType change → ConfirmDialog, dbType / port
  unchanged):
  - Code: `ConnectionDialog.tsx:138` — custom-port branch sets
    `pendingDbTypeChange` only; no `setForm` call. Modal renders at
    `ConnectionDialog.tsx:671-679` only when `pendingDbTypeChange != null`.
  - Test: `ConnectionDialog.test.tsx:1104-1137` — "renders ConfirmDialog
    when current port is custom (15432) and dbType changes" asserts the
    title (`"Replace custom port?"`), the contract message body
    (`/Switching from postgresql to mysql will reset port 15432 → 3306\.
    Continue\?/`), the confirm-button label (`"Use default port 3306"`),
    and that the form values are still `postgresql` / `15432`.
- `AC-04` (Confirm → dbType + paradigm + port = defaults of new type):
  - Code: `ConnectionDialog.tsx:141-145` (`handleConfirmDbTypeReplace`)
    delegates to `applyDbTypeChange`, which writes `db_type`, `port =
    DATABASE_DEFAULTS[dbType]`, and `paradigm = paradigmOf(dbType)` in a
    single `setForm` call (`ConnectionDialog.tsx:117-124`).
  - Tests:
    - `ConnectionDialog.test.tsx:1139-1170` — "Confirm 'Use default port
      3306' applies dbType=mysql + port=3306 and closes the modal" asserts
      the post-confirm form state and that the modal has been removed.
    - paradigm coupling is covered transitively by the existing Sprint 65
      MongoDB test (`ConnectionDialog.test.tsx:762-799`,
      `expect(draft.paradigm).toBe("document")`), which still passes — the
      same `applyDbTypeChange` helper feeds both code paths.
- `AC-05` (Cancel → original dbType + port + paradigm preserved, modal
  removed):
  - Code: `ConnectionDialog.tsx:147-149` (`handleCancelDbTypeReplace`) only
    clears `pendingDbTypeChange`. No form mutation occurred at the open
    site, so the original dbType / port / paradigm are intrinsically
    preserved.
  - Test: `ConnectionDialog.test.tsx:1172-1206` — "Cancel keeps
    dbType=postgres + port=15432 and closes the modal" scopes to the
    `alertdialog` role to disambiguate from the footer Cancel button, then
    asserts dbType `"postgresql"`, port `"15432"`, and that
    `"Replace custom port?"` is gone.
- `AC-06` (regression 0): full suite 1792/1792, 103 files; the previous
  baseline of 1787 + 5 new tests reconciles exactly.

### Screenshots / Links / Artifacts

- Implementation: `src/components/connection/ConnectionDialog.tsx`
  (lines 51, 96-101, 117-149, 671-679).
- Tests: `src/components/connection/ConnectionDialog.test.tsx`
  (lines 1042-1207, new `describe("Sprint 108: DB type change port guard")`
  block).
- Contract: `docs/sprints/sprint-108/contract.md`.
- Findings: `docs/sprints/sprint-108/findings.md`.

## Sprint Contract Status

- [x] `pendingDbTypeChange` state added (AC-03)
- [x] `handleDbTypeChange` defers swap on custom port (AC-03)
- [x] `applyDbTypeChange` updates db_type + port + paradigm atomically
  (AC-04)
- [x] ConfirmDialog uses sprint-95 preset (no ad-hoc Radix Dialog) — invariant
- [x] Title / message / confirmLabel match the contract verbatim (AC-03)
- [x] Confirm path applies the change and closes the modal (AC-04)
- [x] Cancel path leaves form untouched and closes the modal (AC-05)
- [x] Empty / 0 port auto-updates without modal (AC-02)
- [x] Default port auto-updates without modal (AC-01)
- [x] Five tests in `Sprint 108: DB type change port guard` describe block
- [x] No regressions: 1792/1792 (AC-06)

## Scorecard (System Rubric)

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 9/10 | `handleDbTypeChange` cleanly partitions default-or-empty vs custom-port cases. Same-type re-selection short-circuits at the top. The deferred-mutation design makes Cancel a no-op by construction (form was never mutated), so the "dbType 원복 + port 유지" contract is satisfied without a separate revert path. paradigm always tracks dbType because both the auto-update and confirm paths funnel through the single `applyDbTypeChange` helper. |
| Completeness | 9/10 | All five ACs (AC-01..AC-05) are covered by dedicated tests; AC-06 is the suite-wide pass. Title / message / confirmLabel strings match the contract verbatim, including the unicode arrow and the dynamic default-port number in the confirm label. Out-of-scope items (URL mode, host placeholder, mongo conn-string validation) are untouched. The pending-state shape simplification (`{ to }` instead of `{ from, to, preservedPort }`) is justified in findings: `from` and `preservedPort` are read live from `form` because the form mutation is deferred — no drift risk. |
| Reliability | 9/10 | Net delta is small and additive: one new `useState`, one helper extraction (`applyDbTypeChange`), one branch in `handleDbTypeChange`, two tiny handlers, and one conditionally-rendered `<ConfirmDialog>`. Reuses the already-vetted sprint-95 preset (which uses Radix `AlertDialog` underneath, so Esc / outside-click both route to `onCancel`). The deferred-mutation cancel path is structurally race-free because there's no form state to revert. Edge case: same-type re-selection guard prevents accidental modal pop on programmatic re-renders. |
| Verification Quality | 9/10 | Five tests directly mapped to AC-01..AC-05; assertions are tight (form values, modal visibility, exact strings). The Cancel test correctly disambiguates against the footer Cancel button by scoping to `getByRole("alertdialog")`. paradigm coupling under Confirm is transitively covered by the existing Sprint 65 mongodb save test, which is a fair shortcut given both paths share `applyDbTypeChange`. Minor gap: no test directly asserts the alertdialog dismisses on Esc / outside-click, though that path is exercised by `ConfirmDialog`'s own preset tests. |
| **Overall** | **9/10** | Tight, contract-faithful implementation with clean reuse of the sprint-95 preset and a sensible deferred-mutation design. |

## Changed Areas

- `src/components/connection/ConnectionDialog.tsx`: imports
  `ConfirmDialog`; adds `pendingDbTypeChange` state and the
  `applyDbTypeChange` / `handleConfirmDbTypeReplace` /
  `handleCancelDbTypeReplace` helpers; rewrites `handleDbTypeChange` to
  branch on default-or-empty vs custom; renders `<ConfirmDialog>` inside
  the `<Dialog>` tree when a swap is pending.
- `src/components/connection/ConnectionDialog.test.tsx`: adds the
  `Sprint 108: DB type change port guard` describe block with five tests
  covering AC-01..AC-05.

## Assumptions

- `pendingDbTypeChange` only needs `{ to }` because `from` and the
  preserved port can be read directly off the live `form` (the form is
  not mutated until Confirm fires). Findings document this decision and
  cite the user's execution-brief note that the controlled `<select>`
  visually snapping back to the old value during the modal is intentional.
- The footer Cancel button vs the AlertDialog Cancel button must be
  disambiguated in tests by scoping to `getByRole("alertdialog")` — this
  is the standard pattern used elsewhere in the suite when two Cancel
  controls coexist.
- `DATABASE_DEFAULTS[sqlite] === 0` in the connection types — the AC-02
  test relies on this to put the port at 0 by switching to sqlite first,
  rather than typing `0` directly into the input.

## Residual Risk

- The controlled `<select>` snapping back to the old DB type while the
  modal is open is intentional (per execution brief) but could surprise a
  user who expected the select to stay on the new value until they
  confirm. Mitigation: the modal title and confirmLabel make the pending
  swap explicit, and Cancel is the safe default. Manual smoke worth
  doing before release: open ConnectionDialog → set port to 15432 →
  switch to MySQL → observe select snaps back to PostgreSQL → Confirm →
  observe both select and port flip together.
- ConfirmDialog dismiss via Esc / outside-click is delegated to the
  preset (sprint-95 owns those tests). If the preset's dismiss semantics
  ever diverge from `onCancel`, this dialog inherits that drift. Risk is
  low — the preset has its own dedicated test file.
- Custom ports that happen to equal the default of *another* DB type
  (e.g., 3306 while on PostgreSQL) are still treated as custom for the
  current type, which matches the contract's "default for the *current*
  type" semantics. No code change needed; just calling out for future
  reviewers.

## Next Sprint Candidates

- DB-type-aware host placeholder (currently always `"localhost"`) —
  explicitly out of scope for sprint-108 but a natural follow-up.
- URL mode + DB type confirmation: when a parsed URL changes db_type
  while a custom port is also present in the URL, decide whether to
  surface the same confirmation or to trust the URL verbatim. Currently
  out of scope.
- MongoDB connection-string validation as a separate "URL mode" sub-mode
  for mongodb (e.g., `mongodb+srv://...`) — out of scope for sprint-108
  but would close the URL-mode coverage gap for non-RDB types.
