# Sprint 310 Generator Handoff

## Changed files (with purpose)

- `src/lib/mongo/mongoshSnippets.ts` **(NEW)** — Single-module source of
  the 4 snippet sections (Query methods 6 / Mutation methods 7 /
  Operators 13 / Stages 14). Imports `MONGOSH_METHOD_WHITELIST` from
  `mongoshParser.ts` and partitions it into Query vs Mutation — the
  whitelist is the authority for which methods exist; the partition is
  the deliberate UX classification.
- `src/lib/mongo/mongoshSnippets.test.ts` **(NEW)** — Locks section
  ordering, partition completeness vs the whitelist, Q7 operator order,
  wrapped-fragment shape (D-08), and `<placeholder>` syntax (D-06).
- `src/lib/mongo/snippetEngine.ts` **(NEW)** — Thin wrapper around
  `@codemirror/autocomplete`'s `snippet()` API. Exports
  `convertPlaceholders(template)` for `<name>` → `${name}` conversion
  and `insertMongoshSnippet(view, template)` for editor-side insertion.
- `src/lib/mongo/snippetEngine.test.ts` **(NEW)** — Locks placeholder
  conversion (including same-name duplicates), insertion at cursor with
  first-placeholder selection, and the operator wrapped-fragment case.
- `src/components/query/QueryTab/InsertSnippetMenu.tsx` **(NEW)** —
  Popover component using `radix-ui` `Popover` primitives. Renders the
  4 sections as `role="group"` regions with spec-locked `aria-label`s
  and each entry as a `role="menuitem"` button. ArrowDown/ArrowUp
  navigate within a section; Enter activates; Escape closes (Radix
  built-in). On activation: calls `insertMongoshSnippet`, closes
  popover, refocuses the editor.
- `src/components/query/QueryTab/InsertSnippetMenu.test.tsx` **(NEW)**
  — RTL suite covering popover open, 4-group ordering, entry counts/
  contents (full Q7 operator list, 6+7+13+14), click → engine
  invocation + close + refocus, null-ref no-op, ArrowDown/Up nav,
  Enter activation, Escape close.
- `src/components/query/QueryTab/Toolbar.tsx` **(MODIFY)** — Adds
  `editorRef: RefObject<EditorView | null>` to `QueryTabToolbarProps`,
  and mounts `<InsertSnippetMenu editorRef={editorRef} />` inside the
  `{isDocument && (...)}` guard (right after the deprecated-toggle
  comment block, before the `ml-auto` save/favorites cluster). RDB
  paradigm tabs never see the button.
- `src/components/query/QueryTab/Toolbar.test.tsx` **(NEW)** —
  Regression guard for AC-01: button present on document tabs, absent
  on RDB tabs.
- `src/components/query/QueryTab.tsx` **(MODIFY)** — Threads the
  existing `editorRef` from `useQueryEvents` into the toolbar (1-line
  prop addition).
- `docs/phases/phase-28-decisions.md` **(APPEND)** — D-06..D-09 logs
  for placeholder syntax / snippet engine choice / operator wrapped
  fragments / editor ref flow.

## Per-AC evidence

- **AC-01** Button visibility — `Toolbar.test.tsx`:
  - "renders the snippet button on a document-paradigm tab"
  - "does NOT render the snippet button on a RDB-paradigm tab"
- **AC-02** Popover opens with 4 ordered groups — `InsertSnippetMenu.test.tsx`:
  - "opens the popover on click and surfaces 4 section groups in spec order"
- **AC-03** Section contents (counts + names + ordering) —
  `InsertSnippetMenu.test.tsx`: "renders every snippet entry as a
  focusable menuitem button". Plus
  `mongoshSnippets.test.ts`:
  - "lists exactly the 6 read methods in canonical order"
  - "lists exactly the 7 write methods in canonical order"
  - "Query + Mutation snippets exactly partition the 13-method whitelist"
  - "renders the 13 filter operators in the contract's Q7 order"
  - "renders at least 14 aggregate stages drawn from MONGO_AGGREGATE_STAGES"
- **AC-04** Snippet click inserts template + first placeholder selected
  — `snippetEngine.test.ts`:
  - "inserts the template at the cursor with first placeholder selected"
  - "inserts at the current cursor position (not at offset 0) when doc is non-empty"
  - Plus `InsertSnippetMenu.test.tsx`: "clicking an entry calls
    insertMongoshSnippet with the template + closes popover + refocuses
    editor" — locks the engine call wiring; Tab/Shift+Tab/Esc
    navigation itself is delegated to CodeMirror's native
    `snippetKeymap` (decision D-07).
- **AC-05** Same-name placeholder cycling — `snippetEngine.test.ts`:
  - "converts duplicate placeholder names (each occurrence becomes ${name})"
    Lock that the engine produces multi-placeholder CM templates;
    CodeMirror's snippet API natively cycles in document order. Direct
    cycling test on the CodeMirror EditorView is deliberately delegated
    to upstream (built-in behaviour); our regression guard is the
    conversion correctness + the live insertion test.
- **AC-06** Popover keyboard nav — `InsertSnippetMenu.test.tsx`:
  - "ArrowDown moves focus down within a section, ArrowUp moves up"
  - "Enter on a focused entry activates it (same as click)"
  - "Escape closes the popover"
  - Tab/Shift+Tab across sections relies on the browser's native tab
    order (every entry is a real `<button>`) — no custom handler, no
    blocker to natural focus traversal.
- **AC-07** Popover closes + focus returns to editor —
  `InsertSnippetMenu.test.tsx`: "clicking an entry calls
  insertMongoshSnippet ... closes popover + refocuses editor"
- **AC-08** `MONGOSH_METHOD_WHITELIST` single-source —
  `mongoshSnippets.test.ts`:
  - "every Query method label is a member of MONGOSH_METHOD_WHITELIST (single source)"
  - "every Mutation method label is a member of MONGOSH_METHOD_WHITELIST (single source)"
  - "Query + Mutation snippets exactly partition the 13-method whitelist"
  - Plus the grep guard: `grep -n "MONGOSH_METHOD_WHITELIST"
    src/lib/mongo/mongoshSnippets.ts` returns 7 matches (line 8
    comment, line 21 import, lines 57/67/70/88/106 type references).
- **AC-09** `pnpm vitest run` exit 0, regression 0 — 3548 passed / 10
  skipped (baseline was 3515 / 10; delta = +33, exactly matches new
  test count: 14 mongoshSnippets + 9 snippetEngine + 8 InsertSnippetMenu
  + 2 Toolbar visibility).
- **AC-10** `pnpm tsc --noEmit` / `pnpm lint` / `pnpm build` all exit 0.

## Autonomous decisions

- **D-06**: snippet template placeholder syntax `<name>` (user-facing)
  + `${name}` (CodeMirror internal). Conversion via
  `convertPlaceholders` in `snippetEngine.ts`.
- **D-07**: snippet engine uses `@codemirror/autocomplete`'s built-in
  `snippet()` + `snippetKeymap` (Tab/Shift+Tab/Esc handled natively).
- **D-08**: operator snippets are wrapped fragments
  (`{ $gt: <value> }`) — consistent with stage snippets and faster
  paste-and-go UX.
- **D-09**: `editorRef` flows via prop drilling (`useQueryEvents` →
  `QueryTab` → `QueryTabToolbar` → `InsertSnippetMenu`). No new
  context / store.

All four appended to `docs/phases/phase-28-decisions.md`.

## Tests added

- `src/lib/mongo/mongoshSnippets.test.ts` — 14 tests across 6 describe
  blocks.
- `src/lib/mongo/snippetEngine.test.ts` — 9 tests (5 for
  `convertPlaceholders`, 4 for `insertMongoshSnippet`).
- `src/components/query/QueryTab/InsertSnippetMenu.test.tsx` — 8 tests
  across 3 describe blocks (open/close/sections, entry activation,
  keyboard nav).
- `src/components/query/QueryTab/Toolbar.test.tsx` — 2 tests for
  document-vs-RDB visibility.

Total new tests: 33. Baseline 3515 → 3548. No existing tests modified.

## Checks run

- `pnpm vitest run` — 3548 passed / 10 skipped. Exit 0.
- `pnpm tsc --noEmit` — no output. Exit 0.
- `pnpm lint` — no output. Exit 0.
- `pnpm build` — `✓ built in 2.56s`. Exit 0. (Pre-existing chunk-size
  / dynamic-import warnings unrelated to Sprint 310.)
- `grep -n "MONGOSH_METHOD_WHITELIST" src/lib/mongo/mongoshSnippets.ts`
  — 7 matches (line 8 doc comment, line 21 import statement, line 57/67
  type-level partition assertions, line 70/88/106 type parameter
  references).

## Residual risk

- **AC-05 (same-name placeholder Tab cycling) is locked at the
  conversion level + at the live insertion level, but the cycling
  itself is upstream behaviour of CodeMirror's `snippetKeymap`.** If a
  future CodeMirror major version changes the semantics of duplicate
  named placeholders, the test on our side won't catch it. Mitigation:
  conversion test names this dependency explicitly so a CodeMirror
  upgrade will surface here.
- **`InsertSnippetMenu.test.tsx` mocks the snippet engine** to keep the
  RTL surface fast. The engine itself is covered by
  `snippetEngine.test.ts` against a real `EditorView`. The mock seam is
  documented at the top of the file.
- **Popover focus behaviour**: Radix's Popover auto-focuses the first
  focusable child when opened. The test that asserts
  `items[0].focus()` works around this by manually focusing. In manual
  testing the first menu item gets focus automatically. If users
  perceive the auto-focus target as off, a follow-up sprint can add an
  explicit `onOpenAutoFocus` handler.
- **Description spans are `aria-hidden`** so the accessible name of
  each menu item is exactly the snippet label. This means screen
  readers don't announce the description. If a future a11y review
  surfaces a need for description announcement, switch to
  `aria-describedby` linking to the description span.

## Persisted handoff

Wrote this report to `docs/sprints/sprint-310/handoff.md`.
