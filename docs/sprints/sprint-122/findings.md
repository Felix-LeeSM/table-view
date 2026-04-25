# Sprint 122 Evaluation — Findings

## Verification Profile

`command` (no browser).

## Verification Plan Re-Run

| Check | Command | Result |
|-------|---------|--------|
| Type-check | `pnpm tsc --noEmit` | exit 0, no output |
| Lint | `pnpm lint` | exit 0, no output |
| Full vitest | `pnpm vitest run` | **112 files / 1874 tests passed** (sprint-121 baseline 1852 + 22) |
| Hard-stop diff | `git diff --stat HEAD -- src-tauri/ src/components/datagrid/useDataGridEdit.ts src/lib/mongo/mqlGenerator.ts src/components/rdb/ src/lib/paradigm.ts src/components/document/AddDocumentModal.tsx` | empty |
| RDB regression | `pnpm vitest run src/components/rdb/FilterBar.test.tsx` | 26/26 passed |
| New test files | `pnpm vitest run src/lib/mongo/mqlFilterBuilder.test.ts src/components/document/DocumentFilterBar.test.tsx` | 22/22 passed |
| documentStore touched? | `git diff --stat HEAD -- src/stores/documentStore.ts` | empty (handoff claim verified — `FindBody.filter` was already optional, no surgical change required) |

All required checks pass.

## Sprint Contract Status (Done Criteria)

- [x] **AC-01** RDB `FilterBar.tsx` byte-identical — `git diff --stat HEAD -- src/components/rdb/FilterBar.tsx` empty.
- [x] **AC-02** DocumentFilterBar provides toggle + Raw + Structured — `DocumentFilterBar.tsx:174-289` (mode toggle group + Close button + structured rows + Raw editor branch). Tests `DocumentFilterBar.test.tsx:37-44`, `91-100`.
- [x] **AC-03** Structured emits valid MQL JSON, ≥ 5 operators verified — `mqlFilterBuilder.test.ts` covers `$eq` (numeric + string fallback), `$gt`, `$gte` (with merge), `$regex`, `$exists`, plus boundary cases (empty list, blank-only string, multi-field, empty field name). 11/11 pass.
- [x] **AC-04** Raw editor exposes field AC + `$`-operator AC — `DocumentFilterBar.tsx:396-399` calls `useMongoAutocomplete({ queryMode: "find", fieldNames })`. `fieldNames` plumbed from `DocumentDataGrid.tsx:74-77` via `fieldsCacheEntry → filterFieldNames` memo. Editor mount tested at `DocumentFilterBar.test.tsx:91-100`.
- [x] **AC-05** Invalid Raw JSON → inline alert, `onApply` not called — `DocumentFilterBar.tsx:132-158` (`handleRawApply` with two error paths: parse failure + non-object/array). Tests `DocumentFilterBar.test.tsx:136-148` (invalid JSON) and `150-163` (JSON array rejected).
- [x] **AC-06** Mode swap behaviour — Structured → Raw prefill at `DocumentFilterBar.tsx:163-172` (`handleModeChange` calls `buildMqlFilter` + `stringifyMqlFilter`). Verified by `DocumentFilterBar.test.tsx:102-121`. Raw → Structured intentionally retains structured state without parsing — handoff documents this as v1 deferred behaviour ("manual edit required" path).
- [x] **AC-07** DocumentDataGrid mounts FilterBar + runFind accepts filter — `DocumentDataGrid.tsx:292-305` mounts `<DocumentFilterBar>` conditionally on `showFilters`. `DocumentDataGrid.tsx:84-94` passes `filter: activeFilterCount > 0 ? activeFilter : undefined` to `runFind`. `documentStore.runFind` signature unchanged (`FindBody.filter` already optional at `src/types/document.ts:59`).
- [x] **AC-08** RDB regression 0 — `pnpm vitest run src/components/rdb/FilterBar.test.tsx` 26/26 pass; included in full-suite 1874/1874.
- [x] **AC-09** flat-field only; nested/`$elemMatch`/`$in`/`$or`/`$and` deferred — explicitly documented in `mqlFilterBuilder.ts:7-15` doc block and handoff "가정/리스크".
- [x] **AC-10** sprint-120/121 byte-identical — combined hard-stop diff empty (covers `paradigm.ts`, `AddDocumentModal.tsx`, `rdb/`).

## Test File Inspection

### `src/lib/mongo/mqlFilterBuilder.test.ts` (11 tests)

- Strong coverage: empty list, numeric coercion (positive case), numeric fallback, decimal `$gt`, multi-operator merge on same field, `$regex` raw-string semantics, `$exists` boolean coercion (`true`/`False`/empty), implicit multi-field `$and`, empty field-name skip, whitespace-only blank input, `stringifyMqlFilter` pretty-print.
- Notable: explicit boundary test for `Number("  ") === 0` foot-gun (`mqlFilterBuilder.test.ts:88-92`) — exactly the kind of subtle coercion bug worth pinning.
- Helper `condition(field, operator, value)` keeps fixtures readable.

### `src/components/document/DocumentFilterBar.test.tsx` (11 tests)

- Covers happy path (Structured `$gte`, Enter-key submit, Raw apply with `$exists`), Raw error paths (invalid JSON, JSON array), mode swap prefill (verified via `EditorView.findFromDOM`), Close/Clear buttons, empty-fieldNames degraded mode.
- Uses CodeMirror `EditorView.findFromDOM` to read editor content directly — appropriate technique given `cm-content` doesn't expose its text via `value`/`textContent` reliably.
- Uses Radix Select role-based queries (`role="combobox"`, `role="option"`) — aligns with project testing convention.

### Test count delta

Sprint-121 baseline: 1852 → Sprint-122: 1874 (+22 = 11 builder + 11 component). Contract required ≥ +7. Met by 3.1×.

## Code Review Notes

- **Pure function discipline**: `mqlFilterBuilder.ts` has zero React deps and a clean export surface (`MqlOperator`, `MqlCondition`, `MQL_OPERATORS`, `buildMqlFilter`, `stringifyMqlFilter`).
- **CodeMirror pattern reuse**: `RawMqlEditor` follows the sprint-121 `AddDocumentModal` pattern (callback ref + `useState<HTMLDivElement | null>` + `Compartment` for `mongoExtensions` reconfigure + doc-equality guard on `value` sync). Avoids the Radix portal mount race lesson.
- **Auto-create row**: `autoCreatedRef` guard in `DocumentFilterBar.tsx:93-103` correctly fires once and respects empty `fieldNames` (test #11 confirms).
- **Page reset on apply**: `DocumentDataGrid.tsx:295-303` resets `page` to 1 on both apply and clear — correct, since prior page index may be invalid for the new result set.
- **`activeFilterCount` semantics**: counts top-level keys (sane for "implicit `$and` of fields"). `{age: {$gte:18, $lt:65}}` shows as 1 filter — matches RDB single-row semantics.

## Minor Observations (Non-blocking)

1. **`useFieldNamesFromCache` hook is exported but unused internally** (`DocumentFilterBar.tsx:536-547`). Handoff acknowledges this — kept as a helper for future consumers. Not a defect, but slightly contradicts "consume only" minimalism. Consider deleting if no consumer materialises.
2. **`$exists` value field is a free-text input** rather than a boolean toggle. Handoff lists this as a low risk. Anything other than `"true"` (case-insensitive) silently coerces to `false` — acceptable for v1, but a UX paper-cut.
3. **`onApply({})` on empty raw text** (`DocumentFilterBar.tsx:134-138`) — sending an empty filter is technically valid MQL but no test pins this branch. Minor coverage gap.
4. **Test #4 (Enter key)** correctly verifies that `"Ada"` stays a string (no numeric coercion) — good edge case binding.

## Code Quality

- TypeScript: strict, no `any`. `Record<string, unknown>` used for filter shape.
- Lint: 0 warnings/errors.
- Naming: consistent with project conventions (PascalCase components, camelCase hooks/util).
- No TODOs or `console.log` left in production code.

## Sprint 122 Evaluation Scorecard

| Dimension | Weight | Score | Notes |
|-----------|--------|-------|-------|
| **Correctness** | 35% | 9/10 | All 10 ACs satisfied with file:line evidence. Builder handles operator-merge, numeric coercion edge cases (incl. `Number("  ")` foot-gun), and `$regex`/`$exists` special semantics. CodeMirror sync gated by doc equality. Minor: empty-raw-text branch not covered by a test. |
| **Completeness** | 25% | 9/10 | 4 new files + 2 modified (only DataGrid surgically; documentStore untouched because `FindBody.filter` was already optional — verified). +22 tests vs. ≥ +7 required. v1 scope honoured (flat-field only). Mode-swap one-way intentional and documented. |
| **Reliability** | 20% | 8/10 | Editor pattern reuses sprint-121 lessons (callback ref + Compartment + doc-equality guard). Apply paths short-circuit cleanly on error. `activeFilterCount > 0` guard avoids sending empty `{}` over wire. Page reset on apply prevents stale-page footgun. Minor: `$exists` free-text accepts ambiguous strings without warning. |
| **Verification Quality** | 20% | 9/10 | All 4 contract checks captured + extras (per-file vitest, RDB regression, documentStore diff). New tests use role-based queries and `EditorView.findFromDOM` for CodeMirror introspection. Hard-stop diff verified empty. RDB FilterBar test runs 26/26 in isolation. |
| **Overall** | | **8.85/10** | Weighted: 0.35·9 + 0.25·9 + 0.20·8 + 0.20·9 = 3.15 + 2.25 + 1.60 + 1.80 = **8.80** |

Each dimension ≥ 7 → PASS.

## Verdict: PASS

## Feedback for Generator

1. **Coverage gap (Reliability)**: `handleRawApply` empty-trim branch (`DocumentFilterBar.tsx:134-138`) calls `onApply({})` but is unverified.
   - Current: untested.
   - Expected: a test asserting that an all-whitespace Raw editor → `onApply` called with `{}` and no alert.
   - Suggestion: add a 12th component test `clears the filter when the Raw editor is empty`.

2. **Dead-export ergonomics (Completeness)**: `useFieldNamesFromCache` is exported but no in-tree consumer.
   - Current: hook lives at `DocumentFilterBar.tsx:536-547`, unused by the grid (which derives `filterFieldNames` inline).
   - Expected: either delete (smaller surface) or wire the grid to consume it (one source of truth).
   - Suggestion: delete it now; re-add when a second consumer needs it.

3. **`$exists` UX (Reliability)**: free-text input silently coerces non-`"true"` to `false`.
   - Current: `coerceBoolean(raw) === raw.trim().toLowerCase() === "true"`.
   - Expected: typing `"yes"` or `"1"` should at minimum visibly hint the actual coerced value, or the operator should swap the input to a boolean toggle.
   - Suggestion: in a follow-up sprint, switch to a `<Select>` with `true`/`false` options when `operator === "$exists"` (deferred is acceptable; flag in `RISKS.md`).

4. **Doc nit (Verification Quality)**: `mqlFilterBuilder.ts:13` says "numeric coercion is best-effort: a value parses as a number when `parseFloat` round-trips it". Implementation actually uses `Number(raw)` + `Number.isFinite` (which differs from `parseFloat` on inputs like `"3abc"`).
   - Current: doc says `parseFloat`, code uses `Number`.
   - Expected: doc match implementation.
   - Suggestion: change the comment to "a value parses as a number when `Number(raw)` is finite and the input isn't whitespace-only".

## Handoff Evidence Captured

- DocumentFilterBar mount + branching: `DocumentFilterBar.tsx:174-289`.
- mqlFilterBuilder operator handling: `mqlFilterBuilder.ts:71-107` (5 operators verified by tests #2–#7).
- DocumentDataGrid filter wiring: `DocumentDataGrid.tsx:74-108`, `292-305`.
- documentStore.runFind filter parameter: `src/stores/documentStore.ts:41-45, 136` (signature accepts `FindBody`; filter at `src/types/document.ts:59`). No source changes required.
- New tests + AC mapping: in handoff and AC table above.
- 4-check capture: in this document.
- Hard-stop diff empty: confirmed via fresh `git diff --stat`.
