# Handoff: sprint-252

## Outcome

- Status: Complete (Generator green phase finished)
- Summary: PreviewDialog gained `copyText` / `copyAriaLabel` props that
  surface a header-right Copy button (`data-testid="preview-dialog-copy"`)
  with transient "Copied" / "Copy failed" feedback and unmount-safe
  setTimeout cleanup. The state machine + carrier live in a new
  `PreviewCopyButton` component reused by the DataGrid inline SQL preview
  (which also now wraps each `<pre>` body in `<SqlSyntax>`). SqlPreview
  Dialog and MqlPreviewModal each got a 1-line `copyText` prop. All 9
  AC-252-* assertions are satisfied; 14 new test cases pass; full suite
  3017/3017 (baseline 3003 + 14 new). MqlPreview body remains plain `<pre>`
  per AC-252-07 plain fallback.

## Verification Profile

- Profile: command
- Overall score: green (all 7 required checks pass)
- Final evaluator verdict: deferred to harness Evaluator agent

## Evidence Packet

### Checks Run

- `pnpm tsc --noEmit`: pass (0 errors — exit 0, no output)
- `pnpm lint`: pass (0 errors / 0 warnings — `> table-view@0.1.0 lint` then
  `> eslint .` with no findings)
- `pnpm vitest run`: pass (`Test Files  239 passed (239)` /
  `Tests  3017 passed (3017)` — baseline 3003 + 14 new)
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`: pass
  (`test result: ok. 627 passed; 0 failed; 2 ignored`)
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`:
  pass (`Finished \`dev\` profile`, no warnings emitted)
- `rg "preview-dialog-copy" src/`: pass (6 files matched — testid wired in
  `PreviewCopyButton.tsx`, referenced in `DataGrid.tsx` + `PreviewDialog.tsx`
  doc comments, plus the 3 test files — well above ≥ 3)
- `rg "navigator.clipboard.writeText" src/components/ui/dialog/`: pass
  (≥ 1 in `PreviewCopyButton.tsx` per the contract's "or ≥ 1 in
  PreviewCopyButton.tsx if extracted" allowance)

### Acceptance Criteria Coverage

| AC | Test file:line | Production file:line |
|---|---|---|
| `AC-252-01` Copy button renders with testid + aria-label when copyText non-empty | `src/components/ui/dialog/__tests__/PreviewDialog.copy.test.tsx:49-79` | `src/components/ui/dialog/PreviewCopyButton.tsx:108-117` |
| `AC-252-02` Click → `navigator.clipboard.writeText(copyText)` exactly once | `src/components/ui/dialog/__tests__/PreviewDialog.copy.test.tsx:81-99` ; `src/components/document/MqlPreviewModal.copy.test.tsx:63-89` ; `src/components/rdb/DataGrid.preview-copy.test.tsx:161-184` | `src/components/ui/dialog/PreviewCopyButton.tsx:75-95` |
| `AC-252-03` success → "Copied" transient (1500 ms) | `src/components/ui/dialog/__tests__/PreviewDialog.copy.test.tsx:101-131` | `src/components/ui/dialog/PreviewCopyButton.tsx:84-87, 28-32` |
| `AC-252-03` failure → "Copy failed" transient (2000 ms) + console.error | `src/components/ui/dialog/__tests__/PreviewDialog.copy.test.tsx:133-166` | `src/components/ui/dialog/PreviewCopyButton.tsx:88-95, 28-32` |
| `AC-252-04` empty/whitespace `copyText` → button NOT rendered | `src/components/ui/dialog/__tests__/PreviewDialog.copy.test.tsx:168-203` ; `src/components/document/MqlPreviewModal.copy.test.tsx:91-101` | `src/components/ui/dialog/PreviewCopyButton.tsx:99-100` |
| `AC-252-05` SqlPreviewDialog + DataGrid inline preview both contain `.text-syntax-keyword` spans | (SqlPreviewDialog auto via existing AC-109 SqlSyntax body); `src/components/rdb/DataGrid.preview-copy.test.tsx:143-159` | `src/components/structure/SqlPreviewDialog.tsx:88-90` ; `src/components/rdb/DataGrid.tsx:660-665` |
| `AC-252-06` highlight component is read-only (SqlSyntax `<span>` only — keyboard cannot mutate body) | covered by SqlSyntax markup (AC-109 regression — span-only output) | `src/components/shared/SqlSyntax.tsx:26-37` (unchanged) |
| `AC-252-07` MqlPreviewModal body has NO `.text-syntax-keyword` markers (plain fallback) | `src/components/document/MqlPreviewModal.copy.test.tsx:40-61` | `src/components/document/MqlPreviewModal.tsx:70-76` (`<pre>` body unchanged — only `copyText` added) |
| `AC-252-08` 8 existing PreviewDialog callers regress-free | full `pnpm vitest run` 3017 passed (CellDetailDialog, CreateTableDialog, IndexesEditor, ColumnsEditor, ConstraintsEditor, ConnectionDialog, ShortcutCheatsheet, SqlPreviewDialog test files all pass) | n/a — no opt-in `copyText` ⇒ byte-identical render |
| `AC-252-09` commit error / generation error / loading / environment stripe behavior unchanged | `src/components/ui/dialog/__tests__/PreviewDialog.test.tsx` (regression — 6 cases pass) ; `src/components/structure/SqlPreviewDialog.test.tsx` (pass) | `src/components/ui/dialog/PreviewDialog.tsx:130-160` (commit-error block + footer untouched) |

### Tests-First (TDD) evidence

> Tests-first (TDD): 신규 테스트 작성 → red (이전 generator 단계) → 구현 → green (이번 단계)

The 3 test files (`PreviewDialog.copy.test.tsx`, `MqlPreviewModal.copy.test.tsx`, `DataGrid.preview-copy.test.tsx`) were authored by the previous Generator attempt before the Sprint 252 implementation was written. The current Generator attempt verified the red state at the start of this session (`9 failed | 5 passed (14)` initial run) and then implemented the production code to flip them green (`14 passed (14)`).

### Code excerpts

#### PreviewDialog Copy carrier + transient + cleanup
`src/components/ui/dialog/PreviewCopyButton.tsx`:
```tsx
useEffect(() => {
  mountedRef.current = true;
  return () => {
    mountedRef.current = false;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);   // unmount cleanup
      timerRef.current = null;
    }
  };
}, []);

const handleClick = useCallback(async () => {
  const carrier = navigator.clipboard?.writeText?.bind(navigator.clipboard);
  if (!carrier) {
    console.error("Clipboard API unavailable: navigator.clipboard.writeText is missing");
    if (mountedRef.current) setStatus("failure");
    scheduleRevert(FAILURE_TIMEOUT_MS);
    return;
  }
  try {
    await carrier(text);
    if (mountedRef.current) setStatus("success");
    scheduleRevert(SUCCESS_TIMEOUT_MS);
  } catch (err) {
    console.error("Clipboard writeText failed:", err);
    if (mountedRef.current) setStatus("failure");
    scheduleRevert(FAILURE_TIMEOUT_MS);
  }
}, [text, scheduleRevert]);

if (text.trim() === "") return null;       // AC-252-04 self-suppress
…
return (
  <Button
    type="button" variant="ghost" size="sm"
    onClick={() => void handleClick()}
    data-testid="preview-dialog-copy"      // AC-252-01 testid
    aria-label={ariaLabel}                  // AC-252-01 aria-label
    …
  >
    <Icon className="size-3.5" aria-hidden="true" />
    <span>{label}</span>
  </Button>
);
```

`src/components/ui/dialog/PreviewDialog.tsx` — header right side:
```tsx
{copyText !== undefined ? (
  // PreviewCopyButton self-suppresses when `text.trim() === ""`,
  // so empty/whitespace copyText still renders nothing.
  <PreviewCopyButton
    text={copyText}
    ariaLabel={copyAriaLabel}
    className="shrink-0"
  />
) : null}
```

#### DataGrid inline preview SqlSyntax wrap + Copy button
`src/components/rdb/DataGrid.tsx`:
```tsx
<div className="flex items-center gap-1">
  {/* Sprint 252: shared Copy button (PreviewCopyButton) — same
      `data-testid="preview-dialog-copy"` as PreviewDialog … */}
  <PreviewCopyButton
    text={editState.sqlPreview?.join(";\n") ?? ""}
    ariaLabel="Copy SQL to clipboard"
  />
  <button
    className="rounded p-1 hover:bg-muted"
    onClick={() => editState.setSqlPreview(null)}
    aria-label="Close SQL preview"
  >
    <X size={14} />
  </button>
</div>
…
{editState.sqlPreview?.map((sql, i) => {
  const isFailed = editState.commitError?.statementIndex === i;
  return (
    <pre key={i} className={isFailed ? … : …}>
      {/* Sprint 252: SqlSyntax wrap (AC-252-05) … */}
      <SqlSyntax sql={sql} />
    </pre>
  );
})}
```

#### MqlPreviewModal copyText + plain fallback evidence
`src/components/document/MqlPreviewModal.tsx`:
```tsx
// Sprint 252: Plain-text join — Mongo dialect highlighter absent so
// SqlSyntax is intentionally NOT wrapped here (AC-252-07 plain
// fallback). Empty previewLines → joined string is "" → button
// self-suppresses (AC-252-04).
copyText={previewLines.join("\n")}
copyAriaLabel="Copy MQL commands to clipboard"
```
`<pre aria-label="MQL commands">…{previewLines.join("\n")}…</pre>` body
remains unchanged — no `<SqlSyntax>` wrap, so AC-252-07 (`.text-syntax-keyword`
absent in MQL dialog) holds. Verified by
`MqlPreviewModal.copy.test.tsx:40-61`:
```tsx
const keywordSpans = dialog.querySelectorAll("span.text-syntax-keyword");
expect(keywordSpans.length).toBe(0);
```

#### SqlPreviewDialog 1-line copyText
`src/components/structure/SqlPreviewDialog.tsx`:
```tsx
// Sprint 252: Surface header Copy button. PreviewCopyButton self-
// suppresses on empty/whitespace, so a stub `sql=""` keeps the
// button hidden and existing AC-109 markup unchanged.
copyText={sql}
copyAriaLabel="Copy SQL to clipboard"
```

### Screenshots / Links / Artifacts

- Sprint 252 contract: `docs/sprints/sprint-252/contract.md`
- Sprint 252 execution brief: `docs/sprints/sprint-252/execution-brief.md`
- ADR 0022 reference: `memory/decisions/0022-safe-mode-destructive-only-confirm-with-dry-run/memory.md`

## Changed Areas

### New files
- `src/components/ui/dialog/PreviewCopyButton.tsx` — shared Copy button +
  state machine + setTimeout cleanup; reused by PreviewDialog header and
  DataGrid inline preview header. Carries the `data-testid="preview-dialog-copy"` and
  `navigator.clipboard.writeText` carrier in one place to avoid drift.

### Modified files
- `src/components/ui/dialog/PreviewDialog.tsx` — added `copyText?: string` /
  `copyAriaLabel?: string` props + header-right `<PreviewCopyButton>` slot.
  All other props byte-identical; existing 8 callers without `copyText`
  render the same DOM as before (tests confirm).
- `src/components/structure/SqlPreviewDialog.tsx` — passes `copyText={sql}` +
  `copyAriaLabel="Copy SQL to clipboard"` to PreviewDialog. SqlSyntax body
  unchanged (AC-109 preserved).
- `src/components/document/MqlPreviewModal.tsx` — passes
  `copyText={previewLines.join("\n")}` + `copyAriaLabel="Copy MQL commands to clipboard"`.
  Body markup (plain `<pre aria-label="MQL commands">`) unchanged — AC-252-07
  plain fallback.
- `src/components/rdb/DataGrid.tsx` — inline SQL preview header now contains
  `<PreviewCopyButton text={editState.sqlPreview?.join(";\n") ?? ""} … />`
  beside the existing X button; each `<pre>` body wrapped in `<SqlSyntax>`.
  Environment stripe, X close button, autoFocus Execute, commitError banner
  preserved exactly.

### Deleted files
- (none)

## Assumptions

- Test environment ships a redefinable `navigator.clipboard` — both
  `PreviewDialog.copy.test.tsx` and `MqlPreviewModal.copy.test.tsx` install
  the carrier via `Object.defineProperty(navigator, "clipboard", … )` before
  each test and tear it down after. The implementation defensively probes
  `navigator.clipboard?.writeText` so the absence of the carrier triggers
  the same failure path as a rejected promise (rather than throwing).
- Transient timer race: a second click during the "Copied" or "Copy failed"
  window clears the prior pending `setTimeout` before scheduling a new one
  (`scheduleRevert` always clears `timerRef.current` first). Tests pin the
  unmount-cleanup variant (`PreviewDialog.copy.test.tsx:205-242`).
- MQL plain fallback: users see no syntax highlight in MQL preview, only in
  SQL surfaces. This is the intended UX per AC-252-07 — Mongo dialect
  tokens (e.g. `db.users.updateOne`, `$set`) would be misinterpreted by the
  SQL tokenizer and produce wrong colors. The PreviewCopyButton transient
  state machine is uniform across SQL and MQL surfaces, so the user's copy
  affordance feels identical.
- The contract verification check #7 (`rg navigator.clipboard.writeText
  src/components/ui/dialog/PreviewDialog.tsx`) is satisfied via
  `PreviewCopyButton.tsx` — the contract explicitly allows the carrier to
  live in the extracted helper ("or ≥ 1 in PreviewCopyButton.tsx if
  extracted").

## Residual Risk

- **CodeMirror integration deferred**: `SqlPreviewDialog`'s body (and now
  the DataGrid inline preview) still uses the lightweight `<SqlSyntax>`
  tokenizer. The full editor experience (autocomplete, multi-line edit,
  selection actions) is a separate refactor not in this sprint's scope.
- **MQL highlighter absent**: AC-252-07 plain fallback is intentional;
  introducing a Mongo dialect highlighter is out of scope. Future sprints
  could wire a Mongo tokenizer into a sister `MqlSyntax.tsx` and swap the
  `<pre>` body, mirroring SqlPreviewDialog's structure.
- **No toast integration**: dialog-local transient label is the sole
  feedback. If the surrounding dialog closes while a writeText promise is
  still pending, the user loses the "Copy failed" hint. The unmount path
  cancels the timer + suppresses `setStatus`, so the only impact is missing
  feedback (no console warning, no broken state).
- **Per-tab vs all-tabs commit policy**: Sprint 252 only adds Copy +
  highlight affordances; the commit-path (per-tab vs cross-tab) is
  unchanged and remains tracked under AC-GLOBAL-06.
- **DataGrid inline preview NOT migrated to PreviewDialog**: per the
  contract's explicit guidance, the inline `<Dialog>` keeps its bespoke
  markup (environment stripe, X button position, autoFocus Execute,
  commitError banner with `data-testid="datagrid-commit-error"`) because
  these load-bearing details don't 1:1 map onto PreviewDialog's API. Copy +
  SqlSyntax were inserted in-place rather than via PreviewDialog wrapper.

## Next Sprint Candidates

- CodeMirror migration for SqlPreviewDialog body (full editor with
  autocomplete + selection actions).
- MqlSyntax tokenizer + MqlPreviewModal body wrap (mirrors SqlSyntax for
  Mongo dialect — closes the AC-252-07 fallback gap).
- Per-tab vs cross-tab commit policy resolution (AC-GLOBAL-06).
- Inline DataGrid preview migration to PreviewDialog (only if the API can
  absorb environment stripe + custom commitError testid + autoFocus Execute
  without regressions).

## Generator Handoff

### Changed Files

- `src/components/ui/dialog/PreviewCopyButton.tsx` (new): shared Copy button + state machine + carrier + cleanup
- `src/components/ui/dialog/PreviewDialog.tsx`: add `copyText` / `copyAriaLabel` props + header-right Copy slot
- `src/components/structure/SqlPreviewDialog.tsx`: 1-line `copyText={sql}` + `copyAriaLabel`
- `src/components/document/MqlPreviewModal.tsx`: 1-line `copyText={previewLines.join("\n")}` + `copyAriaLabel` (plain fallback preserved)
- `src/components/rdb/DataGrid.tsx`: inline preview header Copy button + each `<pre>` body wrapped in `<SqlSyntax>`
- `docs/sprints/sprint-252/handoff.md` (new): this handoff document

### Checks Run

- `pnpm tsc --noEmit`: pass
- `pnpm lint`: pass (0 / 0)
- `pnpm vitest run`: pass (3017 passed, baseline 3003 + 14 new)
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`: pass (627 passed)
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`: pass
- `rg "preview-dialog-copy" src/`: pass (6 files)
- `rg "navigator.clipboard.writeText" src/components/ui/dialog/`: pass (≥ 1 in PreviewCopyButton.tsx — contract permits extracted location)

### Done Criteria Coverage

- DC1 (Copy button + carrier + transient): `PreviewCopyButton.tsx:108-117` (testid + aria-label) + `:75-95` (carrier + transient) — verified by `PreviewDialog.copy.test.tsx:49-166`
- DC2 (empty/whitespace → no render): `PreviewCopyButton.tsx:99-100` — verified by `PreviewDialog.copy.test.tsx:168-203` and `MqlPreviewModal.copy.test.tsx:91-101`
- DC3 (unmount timer cleanup): `PreviewCopyButton.tsx:51-60` — verified by `PreviewDialog.copy.test.tsx:205-242`
- DC4 (SqlPreviewDialog `copyText={sql}`): `SqlPreviewDialog.tsx:88-90` — auto-test via existing AC-109 regression
- DC5 (MqlPreviewModal plain fallback): `MqlPreviewModal.tsx:50-55` — verified by `MqlPreviewModal.copy.test.tsx:40-61`
- DC6 (DataGrid inline preview SqlSyntax wrap + Copy): `DataGrid.tsx:638-657, 660-665` — verified by `DataGrid.preview-copy.test.tsx:143-184`
- DC7 (AC-252-01..09 mapping): see "Acceptance Criteria Coverage" table above
- DC8 (TDD flow): tests authored by previous Generator (red), this Generator implemented green
- DC9 (7 verification checks all pass): see "Checks Run"

### Assumptions

- Test env redefinable `navigator.clipboard`; carrier defensively probed
- Transient timer race resolved via `clearTimeout` before scheduling
- MQL plain fallback intentional — no Mongo tokenizer available
- Carrier in `PreviewCopyButton.tsx` (not `PreviewDialog.tsx`) — explicitly permitted by contract

### Residual Risk

- CodeMirror migration deferred (out of scope)
- MQL highlighter absent (AC-252-07 plain fallback)
- No toast integration (dialog-local label only)
- Per-tab vs all-tabs commit policy untouched (AC-GLOBAL-06)
- DataGrid inline preview retains bespoke markup; not migrated to PreviewDialog wrapper (per contract guidance — load-bearing markup mismatch)
