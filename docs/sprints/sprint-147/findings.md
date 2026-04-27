# Sprint 147 — Findings

## Outcome

**PASS** — AC-149-* invariants locked with explicit regression tests. Sprint
140 had already shipped the SelectionTree + encrypted-only export pane;
this sprint adds a dedicated test file that pins the five sub-clauses so a
future change cannot silently regress.

## Verification

- `pnpm vitest run` — 146 files / **2233 tests** (+5 new, all in the new file).
- `pnpm tsc --noEmit` — exit 0.
- `pnpm lint` — exit 0.

## Changed Files

| File | Purpose |
|---|---|
| `src/components/connection/ImportExportDialog.ac149.test.tsx` | New regression file with 5 `it(...)` blocks named after AC-149-1 … AC-149-5. |
| `docs/sprints/sprint-147/{contract,execution-brief,findings}.md` | Sprint artifacts. |

No production source changed — invariant: "no UI/UX change visible to end users" upheld.

## AC Coverage (this sprint's deltas)

| AC | Status | Evidence |
|---|---|---|
| AC-149-1 (single-connection scoping) | ✅ | `it("AC-149-1: ...")` clears default-all, ticks one row, asserts `exportConnectionsEncrypted.mock.calls[0]` ids === `["c2"]` (length 1) and plaintext `exportConnections` never called. |
| AC-149-2 (group-header → group ids only + counter shape) | ✅ | `it("AC-149-2: ...")` ticks `Group Prod` header → asserts `2 connections, 1 group selected` counter and that the envelope ids are `{a1, a2}` (Stage child `b1` excluded). |
| AC-149-3 (partial group counter + aria-checked=mixed) | ✅ | `it("AC-149-3: ...")` ticks one of two children, asserts counter `1 connection, 0 groups selected` and `Group Prod` checkbox `aria-checked="mixed"`. |
| AC-149-4 (password-bearing rows reach envelope; legacy plaintext never wired) | ✅ | `it("AC-149-4: ...")` mixes `has_password=true/false`, asserts envelope ids contain all three (no strip) and `exportConnections` plaintext command was never called. |
| AC-149-5 (no plaintext "Generate JSON" surface) | ✅ | `it("AC-149-5: ...")` walks every button in the dialog — any `Generate JSON` label must include `encrypted`; explicit `queryByText` for stray plaintext labels is null. |

## Assumptions

- The existing `ImportExportDialog.test.tsx` already round-trips an
  encrypted envelope through `exportConnectionsEncrypted` end-to-end (line
  86 onwards). AC-149-* tests deliberately do not duplicate that — they
  pin the **scoping** invariants (which ids reach the backend, which
  surface is wired, what the counter says) that round-trip alone wouldn't
  catch.
- Plaintext-leakage assertion is structural (no plaintext button + legacy
  command never invoked) rather than ciphertext-byte-level — the latter
  belongs to backend tests, not jsdom.

## Risks / Deferred

- **Visual regression on the SelectionTree counter**: pinned only via
  text-match (`/N connections, M groups? selected/i`). A wholesale
  refactor that changes the noun ("connections" → "rows") would still
  pass jsdom but break parity with the spec. Acceptable for this sprint
  since the counter is also pinned by `SelectionTree.test.tsx`.
- **Cross-dialog plaintext leak**: AC-149-5 only walks buttons inside the
  Import/Export dialog. Other dialogs (DiagnosticsDialog, etc.) are not
  swept. Out of scope per contract.
