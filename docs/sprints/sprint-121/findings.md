# Sprint 121 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness (35%) | 9/10 | All 9 ACs implemented and verified. CodeMirror editor wired with `useMongoAutocomplete({ queryMode: "find", fieldNames })` (`AddDocumentModal.tsx:92-95`); fieldsCache lookup keyed on `${connectionId}:${database}:${collection}` (`AddDocumentModal.tsx:82-90`); Mod-Enter binding placed before defaultKeymap so it wins (`AddDocumentModal.tsx:152-159`); `JSON.parse` + `isPlainObject` semantics + parseError messages preserved byte-for-byte (`AddDocumentModal.tsx:105-128`); parent `error` prop suppressed when local parseError active (`AddDocumentModal.tsx:269-278`); DocumentDataGrid wires the new optional props through (`DocumentDataGrid.tsx:464-477`). |
| Completeness (25%) | 9/10 | All 9 ACs satisfied. 7 sprint-87 base cases preserved (semantically; helper-only swap from `fireEvent.change` → `view.dispatch`) plus 5 new sprint-121 cases. DocumentDataGrid toolbar Add test updated as a single-line helper change (`DocumentDataGrid.test.tsx:382-420`). Hard-stop diff is empty. Single-document scope retained via `isPlainObject` guard. |
| Reliability (20%) | 8/10 | Sound state hygiene: `EMPTY_FIELDS` module constant avoids per-render array identity churn; `useMemo` stabilises `fieldNames` so `useMongoAutocomplete`'s memo dep is stable; `Compartment.reconfigure` keeps the editor alive across `mongoExtensions` updates (`AddDocumentModal.tsx:227-235`). `submitRef` pattern dodges stale-closure in keymap binding. View destroyed on unmount. `try { view.focus() } catch {}` documents intent (UX-only). `beforeEach(() => useDocumentStore.setState({ fieldsCache: {} }))` in test prevents store leakage. |
| Verification Quality (20%) | 8/10 | All four required checks pass: `pnpm tsc --noEmit` exit 0; `pnpm lint` exit 0; `pnpm vitest run` 110 files / **1852/1852** (1847 + 5); hard-stop `git diff --stat` empty. Each AC cited with file:line in handoff. AC-02/AC-03 tests are observation-by-negation (popup absent, derived `fieldNames` array equality) rather than direct candidate-list assertions, which is reasonable given jsdom limits — but slightly weaker evidence than wiring `CompletionContext` against the actual override source. |
| **Overall** | **8.6/10** | |

## Verdict: PASS

All four threshold dimensions ≥ 7. No P1 findings; one P2 worth noting and two minor P3 observations.

## Sprint Contract Status (Done Criteria)

- [x] AC-01 — CodeMirror EditorView constructed in `AddDocumentModal.tsx:200-203`; container has `role=textbox` + `aria-multiline=true` (`AddDocumentModal.tsx:256-262`); test "renders a CodeMirror editor (no <textarea>) with role=textbox" asserts `<textarea>` absent and `.cm-editor` present.
- [x] AC-02 — `useMongoAutocomplete({ queryMode: "find", fieldNames })` (`AddDocumentModal.tsx:92-95`). `fieldNames` derived from `documentStore.fieldsCache[${connId}:${db}:${coll}]` (`AddDocumentModal.tsx:82-90`). Test "surfaces fieldsCache field names …" verifies derived array equals `["active","email"]`.
- [x] AC-03 — `createMongoCompletionSource({ queryMode: "find", fieldNames })` (via `useMongoAutocomplete`) feeds `MONGO_TYPE_TAGS` at value positions (`mongoAutocomplete.ts:107-121, 345`). NOTE: the contract names `ObjectId / ISODate / NumberLong / NumberDecimal`, but the actual completions are the **BSON Extended JSON tag form** (`$oid`, `$date`, `$numberLong`, `$numberDecimal`). Handoff acknowledges this. Functionally equivalent for round-tripping through `JSON.parse`, but worth flagging (P3).
- [x] AC-04 — `keymap.of([{ key: "Mod-Enter", run }, ..., ...defaultKeymap])` (`AddDocumentModal.tsx:152-168`). Test "submits via Cmd+Enter keyboard shortcut from the editor" exercises the binding directly. Esc/Cancel via FormDialog/Radix retained.
- [x] AC-05 — parseError branches preserved byte-identical: empty → "Document is required"; JSON.parse throw → "Invalid JSON: …"; non-object → "Document must be a JSON object". `error` prop only renders when `!parseError` (`AddDocumentModal.tsx:274`). Tests cover both messages and exclusive rendering.
- [x] AC-06 — Optional `connectionId/database/collection`. When any is missing, `fieldsCacheEntry` is `undefined` and `fieldNames` falls through to `EMPTY_FIELDS` (`AddDocumentModal.tsx:82-90`). Test "falls back to no field-name AC when connection scope is omitted" asserts the autocomplete tooltip never mounts.
- [x] AC-07 — 7 sprint-87 cases preserved (helper-only change) + 5 new sprint-121 cases = 12/12 pass. Vitest total 1852/1852.
- [x] AC-08 — `isPlainObject` retained → JSON arrays still rejected; insertMany / array input remains explicitly out (no array-handling code path added).
- [x] AC-09 — `git diff --stat HEAD -- src-tauri/ src/components/datagrid/useDataGridEdit.ts src/lib/mongo/mqlGenerator.ts src/hooks/useMongoAutocomplete.ts src/components/rdb/ src/lib/paradigm.ts` → empty.

## Verification Evidence (command profile)

| Check | Result |
|-------|--------|
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm vitest run` | 110 files / 1852 passed / 0 failed (baseline 1847 + 5 sprint-121 = 1852 ✓) |
| `git diff --stat HEAD -- <hard-stop globs>` | empty |

## P1 Findings

None.

## P2 Findings

1. **AC-02 / AC-03 test assertions are weak (observation-by-negation)** — `AddDocumentModal.test.tsx:180-205, 207-260`
   - Current: "falls back to no field-name AC" only asserts `.cm-tooltip-autocomplete` is null after typing `{"`; "surfaces fieldsCache field names" asserts the **store** contains the right names but never proves those names actually flow through the registered override into the candidate list. The author leaves a comment ("To avoid coupling to internals, we assert the negative observable …") explaining the choice, but the AC test does not bind end-to-end.
   - Expected: A direct call against `createMongoCompletionSource({ queryMode: "find", fieldNames })` (already a public export of `mongoAutocomplete.ts`) with a synthesised `CompletionContext` that asserts `result.options` contains `{label:"active"}` and `{label:"email"}` at a quoted-key position; and an empty-fieldNames variant that returns `null`.
   - Suggestion: keep the existing DOM-level negative assertion as a smoke check, but add one direct `createMongoCompletionSource` invocation per AC to anchor the contract. Cost: ~10 lines, no new mocks.

## P3 Findings

1. **AC-03 wording vs implementation** — `docs/sprints/sprint-121/contract.md:44`, `mongoAutocomplete.ts:107-121`
   - Current contract says "BSON helper AC (ObjectId / ISODate / NumberLong / NumberDecimal)". The implementation actually exposes the BSON Extended JSON tag spellings (`$oid`, `$date`, `$numberLong`, `$numberDecimal`) — i.e. the JSON-parseable form, not the JS constructor form.
   - Expected: Contract language matches implementation, or implementation adds parseable-via-JSON.parse synonyms. Constructor-form (`ObjectId("…")`) is **not valid JSON**, so the current implementation is the correct one for an `AddDocument` modal whose submit path is `JSON.parse`.
   - Suggestion: amend `contract.md` AC-03 to read `$oid / $date / $numberLong / $numberDecimal` (Extended JSON v2). No code change needed.

2. **`buildLangExtension` redefined inside `useEffect`** — `AddDocumentModal.tsx:131-134`
   - Current: declared at component scope and referenced from inside both effects. Fine; identity changes every render but only used at effect-run time, so it's harmless.
   - Expected/Suggestion: optional — pull into module scope (it has no closure) or wrap in `useCallback`. No correctness impact.

## Feedback for Generator

1. **[Tests]**: Add a direct `createMongoCompletionSource` invocation in `AddDocumentModal.test.tsx` for both AC-02 (empty fieldNames → null at quoted-key) and AC-03 (`$oid`/`$date`/etc present at value position). The current tests assert preconditions but not the candidate output.
2. **[Contract]**: Reword AC-03 in `contract.md` to use Extended JSON tag names (`$oid`, `$date`, `$numberLong`, `$numberDecimal`) so the contract matches what `MONGO_TYPE_TAGS` actually offers — the constructor form (`ObjectId(…)`) is not JSON-parseable and would break the modal's submit path.

## Handoff Summary

- **Sprint 121 result**: PASS (1 attempt). 1852/1852 tests, tsc 0, lint 0, hard-stop diff empty.
- **Files changed (3 prod + 2 test)**:
  - `src/components/document/AddDocumentModal.tsx` (refactor: textarea → CodeMirror)
  - `src/components/document/DocumentDataGrid.tsx` (props passthrough)
  - `src/components/document/AddDocumentModal.test.tsx` (helper swap + 5 new cases)
  - `src/components/document/DocumentDataGrid.test.tsx` (1-line helper swap on toolbar Add)
- **Hard-stop diff**: empty (`src-tauri/`, `useDataGridEdit.ts`, `mqlGenerator.ts`, `useMongoAutocomplete.ts`, `src/components/rdb/`, `src/lib/paradigm.ts`).
- **Open findings**: 0 P1 / 1 P2 / 2 P3. Sprint exit criteria met.
- **Next sprint**: 122 (DocumentFilterBar) can start on the same folder layout.
