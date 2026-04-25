# Sprint 103 — Generator Findings

## Changed Files

- `src/components/shared/ShortcutCheatsheet.tsx` (new) — Global keyboard
  shortcut cheatsheet modal. Self-contained: owns its own `open` state and
  registers a `keydown` listener on `document` for `?` and Cmd/Ctrl+/. Uses
  the sprint-96 `PreviewDialog` preset in read-only mode (no `onConfirm` →
  no footer; absolute X is the only confirm affordance, mirroring
  `CellDetailDialog`). Defines a top-level `SHORTCUT_GROUPS` constant so the
  data is colocated with the component, includes a search input that
  filters case-insensitively across both `label` and `keys`, and renders
  groups as `<dl>` rows with `<kbd>`-styled `<dd>` chips. Empty-state
  message ("No shortcuts match") is rendered when the filter eliminates
  every row.
- `src/App.tsx` — Two-line change: import `ShortcutCheatsheet` and mount it
  next to `<QuickOpen />` inside the existing root JSX. **No existing
  shortcut handler was touched.**
- `src/components/shared/__tests__/ShortcutCheatsheet.test.tsx` (new) — 8
  cases covering AC-01..06: open via `?`, INPUT-focus guard, Cmd+/, Ctrl+/,
  group-label rendering, "format" filter narrowing to a single row, empty
  state, and bonus "F5" key-text match assertion.

## Decisions

- **Preset choice**: `PreviewDialog` (read-only, no `onConfirm`). The
  cheatsheet has no destructive action, so a confirm footer would be
  noise; `PreviewDialog` already handles the read-only case and is the
  preset explicitly preferred by the contract.
- **Listener owner**: The component itself, not `App.tsx`. The contract
  permits either approach and the brief recommends component-owned
  listeners; this keeps `App.tsx` to a one-line mount and lets the open
  state stay co-located with the only consumer.
- **`?` guard**: INPUT/TEXTAREA/SELECT/contenteditable check via a small
  `isEditableTarget` helper. Same shape as the existing guard in
  `App.tsx`'s shared shortcut effect. Cmd/Ctrl+/ skips the guard since the
  modifier combo cannot be produced while typing.
- **Search semantics**: Case-insensitive substring match against `label`
  joined with all `keys` ("Refresh F5"), so a user can search by either the
  action or the keycap text. Empty/whitespace search collapses to "show
  all".
- **Key labels**: Left as-is (`Cmd+W`, `Cmd+/`, etc.) — macOS-vs-Windows
  branching is explicitly out of scope per the contract.
- **No new shortcuts** were added to `App.tsx`; the cheatsheet's own
  `?` / Cmd+/ open path is owned entirely by the component, satisfying the
  invariant "기존 단축키 핸들러 동작 변경 금지".

## Verification

| Check                                                        | Result   |
| ------------------------------------------------------------ | -------- |
| `pnpm vitest run`                                            | 101 files / **1757 passed** (1749 → 1757, +8 new) |
| `pnpm tsc --noEmit`                                          | clean (0 errors) |
| `pnpm lint`                                                  | clean (0 errors, 0 warnings) |

## Acceptance Criteria Mapping

| AC    | Evidence |
| ----- | -------- |
| AC-01 | Test "opens when `?` is pressed outside an editable target" — fires `keydown` with `key="?"` on `document.body` and asserts dialog title appears. |
| AC-02 | Tests "opens on Cmd+/" and "opens on Ctrl+/ as well as Cmd+/" — fires `key="/"` with `metaKey`/`ctrlKey` and asserts dialog opens. |
| AC-03 | Test "ignores `?` when focus is inside an INPUT" — appends an `<input>`, focuses it, fires `?` with the input as target, asserts dialog stays closed. |
| AC-04 | Test "renders every group label when the search box is empty" iterates over `["Tabs", "Editing", "Navigation", "Panels", "Misc"]` and asserts each is in the document. |
| AC-05 | Test "filters down to a single matching row when searching for 'format'" — types `"format"` into the search input and asserts `Format SQL` is visible while `Close tab`, `Quick open`, `Settings`, and `Uglify SQL` are absent. |
| AC-06 | Test "shows the 'No shortcuts match' empty state when no rows match" — types a non-matching string and asserts the empty-state copy renders and the group labels disappear. |
| AC-07 | Full suite: 1749 → 1757 passing (no regressions, +8 new tests for this sprint). |

## Assumptions

- The cheatsheet does not need a "Don't show this again" or persisted
  preference — it is purely on-demand.
- `<kbd>`-styling is achieved through Tailwind `font-mono` chips rather than
  the literal `<kbd>` tag because there is no global `<kbd>` style in this
  codebase, and the rest of the keyboard-aware dialogs (e.g. QuickOpen)
  also use plain spans.
- "Search input matches label OR keys" is interpreted as a substring match
  on the concatenation `"<label> <keys joined by space>"`, which makes
  queries like `"F5"` and `"Cmd+I"` both work without extra normalization.
- The component renders nothing (`return null`) when closed, so mounting it
  permanently in `App.tsx` adds no DOM until the user invokes it.

## Residual Risk

- None known. The `?` global listener is registered on `document` and is
  cleaned up on unmount; the only existing test that simulates `keydown`
  events on `document.body` (the App shortcut suite) still passes
  unchanged because `?` and Cmd/Ctrl+/ are not bindings used by any other
  handler. The cheatsheet's listener uses `event.preventDefault()` only
  when it itself acts, so it cannot interfere with other shortcuts.
