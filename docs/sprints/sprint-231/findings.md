# Sprint 231 — Findings

## §1 — AC-231-04: `useDataGridPreviewCommit.ts` audit

**Result: NO LEAK. File diff = 0.**

### Method

Walked `src/hooks/useDataGridPreviewCommit.ts` line-by-line, looking for any
path that dispatches `executeQueryBatch` or `dispatchMqlCommand` without first
running it through the `safeModeGate.decide(analyzeStatement(...))` matrix.

### Audit citations

- **`handleCommit` (line 158–235)** — Only opens the preview dialog state
  (`setSqlPreview` / `setMqlPreview`); never calls `executeQueryBatch`. Both
  paradigm branches (`document` line 167–201 and RDB line 202–222) terminate
  by setting preview state. PASS.

- **`runRdbBatch` (line 276–353)** — Wraps the actual `executeQueryBatch`
  call (line 281). All callers must funnel through `handleExecuteCommit` or
  `confirmDangerous`. PASS (caller-gated).

- **`handleExecuteCommit` (line 355–459)** — RDB branch (line 413–444)
  iterates `statements` and calls `safeModeGate.decide(analyzeStatement(stmt.sql))`
  on EVERY statement (line 422–423) BEFORE calling `runRdbBatch`. On `block`
  it sets `commitError` and returns (line 424–434). On `confirm` it sets
  `pendingConfirm` and returns (line 435–442). Only `allow` falls through
  to `runRdbBatch`. PASS.

  Document branch (line 356–412) intentionally does NOT use the SQL gate —
  Mongo paths use the Mongo-specific gate at the editor surface
  (`useQueryExecution` aggregate path) and `useRawQueryGridEdit` (read by
  `useDataGridEdit`) for find/aggregate from the grid. The MQL surface
  here is `insertOne` / `updateOne` / `deleteOne` document-id-scoped
  commands which are intrinsically per-row (cannot be `delete-all` /
  `update-all`). Per Sprint 188 contract, the document grid commit path
  is gated at the Mongo pipeline level, not at this hook. PASS by
  contract scope.

- **`confirmDangerous` (line 464–471)** — Re-enters `runRdbBatch` after
  clearing `pendingConfirm`. The gate has already approved at the warn
  tier (user typed reason verbatim). PASS by design.

- **`cancelDangerous` (line 473–488)** — Sets `commitError` and clears
  `pendingConfirm`; never calls `runRdbBatch` / `executeQueryBatch`. PASS.

- **`resetPreviewState` (line 490–495)** — Clears state only; never
  dispatches. PASS.

### Promote-tab / Quick-Look check

The brief calls out `clearAllPending` callbacks that fire from outside the
hook. Search results:

```
$ grep -n "clearAllPending" src/hooks/useDataGridPreviewCommit.ts
122:    clearAllPending,
289:        clearAllPending();      # success branch only — AFTER executeQueryBatch
349:    clearAllPending,
454:    clearAllPending,
```

`clearAllPending` is invoked only in the success branch of `runRdbBatch`
(line 289), which executes AFTER `executeQueryBatch` resolves. There is no
path where `clearAllPending` runs before the gate, so the promote-tab race
described in AC-231-04 is closed.

### Conclusion

`useDataGridPreviewCommit.ts` is correctly gated. **No code change
needed; diff = 0.**

---

## §2 — AC-231-05: `ConnectionDialog` environment dropdown audit

**Result: PRESENT AND FUNCTIONAL. File diff = 0.**

### Method

Read `src/components/connection/ConnectionDialog/ConnectionDialogBody.tsx`
line 250–280 (the brief's reference) and `src/types/connection.ts` line
259–286 to verify the `ENVIRONMENT_OPTIONS` enumeration includes
`production`.

### Audit citations

- **Dropdown markup (`ConnectionDialogBody.tsx:250–280`)**:
  - line 252 — `<label htmlFor="conn-environment">Environment</label>`
  - line 255 — `<Select value={form.environment ?? ENV_NONE_SENTINEL} onValueChange={...}>`
  - line 264–270 — `<SelectTrigger id="conn-environment" aria-label="Environment">`
  - line 272 — `<SelectItem value={ENV_NONE_SENTINEL}>None</SelectItem>`
  - line 273–277 — iterates `ENVIRONMENT_OPTIONS` and emits one
    `<SelectItem>` per env tag.

- **`ENVIRONMENT_OPTIONS` (`src/types/connection.ts:280-286`)**:
  ```ts
  export const ENVIRONMENT_OPTIONS: EnvironmentTag[] = [
    "local",
    "testing",
    "development",
    "staging",
    "production",   // ← present
  ];
  ```
  `production` is the 5th option, label `"Production"`, color `#ef4444`
  (`ENVIRONMENT_META`).

- **`ENV_NONE_SENTINEL`** — represents `null` selection in the
  Radix-Select string-only model; `onValueChange` maps it back to `null`
  before persisting. Per Sprint 138 ADR.

- **Existing test coverage (`ConnectionDialog.test.tsx:555-629`)** — six
  cases assert: dropdown rendering, `None` default, pre-select on edit,
  save round-trip, and `None` → environment reset. Tests exercise both
  the create and edit paths. No gap.

### User-action note

The 2026-05-07 P0 user reported `UPDATE users SET active = false`
executed without confirmation on a production connection. If the user
selected `None` (or any non-production tag) when registering the
connection, `decideSafeModeAction` returns `allow` BY DESIGN — the env
gate is the user's contract for distinguishing safe sandboxes from
production. The fix in this sprint adds the gate; the user must also
tag the connection as `production` for the gate to engage. Operational
follow-up (`docs/RISKS.md` candidate): consider auto-detecting
production via host name patterns or surface a `production?` toggle on
the connection-list trigger. **Out of scope for Sprint 231** — see
contract Out of Scope.

### Conclusion

The dropdown is present, accessible (`aria-label="Environment"`),
covers all 5 environment tags including `production`, and has test
coverage. **No code change needed; diff = 0.**

---

## Residual risk / followups

- **Statement analyzer coverage** — `analyzeStatement` is unchanged (frozen
  by contract). Forms not detected as `danger` today (e.g.
  `WITH x AS (...) DELETE FROM x` CTE prefix, MERGE, REPLACE INTO,
  `DELETE FROM ... USING ... WHERE` PG extension) bypass the new gate.
  Documented in `docs/RISKS.md` candidate; backlog for a hardening sprint.
- **Multi-statement reason surfacing** — only the first dangerous
  statement's reason is shown in the dialog header. The full statement
  list is rendered verbatim in the preview pane (line 240
  `pendingRdbConfirm.statements.join(";\n")`), so the user sees all
  dangerous content before confirming.
- **No cancel toast** — `cancelRdbDangerous` clears state silently to
  match the running-state invariant (never entered `running`). Consider
  a toast in a follow-up polish sprint.

## TDD evidence

- `tdd-evidence/red-state.log` — 6 of 8 cases failed BEFORE the fix
  (`expected vi.fn() to not be called at all, but actually been called N times`).
- After fix: 8 / 8 PASS.
