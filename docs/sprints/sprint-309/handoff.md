# Sprint 309 Generator Handoff

## Summary

Phase 28 Slice A3 — Editor surface simplification. Removed the
Find/Aggregate `ToggleGroup` from the toolbar, dropped the `queryMode`
prop from `MongoQueryEditor`, collapsed `useMongoAutocomplete` to a
single dispatch surface, stopped defaulting new document tabs to
`queryMode: "find"`, and marked `QueryTab.queryMode` `@deprecated` on
the store types. All 10 contract ACs are GREEN. `useQueryExecution.ts`
intentionally untouched (Sprint A5 target).

## Changed files

- `src/components/query/QueryTab/Toolbar.tsx` — delete `ToggleGroup`
  block, drop `onSetQueryMode` prop, drop `QueryMode` import. (modify)
- `src/components/query/MongoQueryEditor.tsx` — drop `queryMode` prop
  from `MongoQueryEditorProps`, drop `data-query-mode` attribute,
  hard-code `aria-label="MongoDB Query Editor"`. (modify)
- `src/components/query/QueryTab.tsx` — stop passing `queryMode` /
  `onSetQueryMode` to children, drop `setQueryModeAction` selector and
  local `setQueryMode` wrapper, drop the dead `tab.queryMode ===
  "aggregate"` derivation in the `useMongoAutocomplete` call. (modify)
- `src/components/query/QueryEditor.tsx` — paradigm router no longer
  forwards `queryMode` to `MongoQueryEditor`; `data-query-mode` removed
  from kv/search placeholders. (modify; only referenced by its own
  test, but kept in lockstep so the build / `pnpm test` stay green.)
- `src/hooks/useMongoAutocomplete.ts` — drop the `queryMode` argument
  from `UseMongoAutocompleteOptions`; underlying
  `createMongoCompletionSource` is invoked with `queryMode: "aggregate"`
  (sentinel for the operator + stages + accumulators + types union).
  (modify)
- `src/hooks/useMongoAutocomplete.test.ts` — drop the find/aggregate
  flip cases, add "no-args call" guard. (modify)
- `src/components/document/AddDocumentModal.tsx` — call
  `useMongoAutocomplete({ fieldNames })` without `queryMode`. (modify)
- `src/components/document/DocumentFilterBar.tsx` — same as above for
  the `RawMqlEditor` inline component. (modify)
- `src/stores/workspaceStore/types.ts` — mark `queryMode` `@deprecated`
  via JSDoc and flip it to optional (`queryMode?: QueryMode`). (modify)
- `src/stores/workspaceStore.ts` — `addQueryTab` document branch no
  longer defaults to `"find"`; RDB branch still sets `"sql"`. (modify)
- `src/stores/workspaceStore.queryMode.test.ts` — NEW store unit suite
  locking the Sprint 309 backward-compat contract (new doc tab leaves
  `queryMode` undefined; legacy persisted payloads with `"find"` /
  `"aggregate"` survive `loadPersistedWorkspaces`). (add)
- `src/components/query/MongoQueryEditor.test.tsx` — collapse the two
  find/aggregate aria-label assertions into one "unified aria-label"
  assertion; drop `queryMode` prop from the remaining render calls.
  (modify)
- `src/components/query/QueryEditor.test.tsx` — same prop / aria-label
  cleanup. (modify)
- `src/components/query/QueryTab.document.test.tsx` — replace the old
  "renders toggle" / "click flips state" cases with a single regression
  guard asserting the toggle is absent on both paradigms. (modify)
- `src/components/query/QueryTab.dialect.test.tsx` — delete the
  "queryMode flip rebuilds mongoExtensions" case (no longer reachable;
  hook signature dropped the queryMode arg). (modify)
- `docs/archives/phases/retired/phase-28-decision-log.md` — append D-04 / D-05 under a new
  Sprint 309 section. (modify)

## Per-AC evidence

- **AC-01** (toolbar toggle removed): `QueryTab.document.test.tsx`
  test `does NOT render the Find / Aggregate toggle on either paradigm
  (Sprint 309)` (line ~346). RTL asserts
  `queryByRole("group", { name: /Mongo query mode/i }) === null` for
  both paradigms.
- **AC-02** (`queryMode` prop removed): `MongoQueryEditor.test.tsx`
  test `renders with the unified MongoDB aria-label and JSON language
  (Sprint 309)` asserts `aria-label="MongoDB Query Editor"`,
  `data-paradigm="document"`, and **no** `data-query-mode` attribute.
- **AC-03** (`QueryTab.tsx` no longer passes `queryMode` /
  `onSetQueryMode`): `grep -n "queryMode\|onSetQueryMode"
  src/components/query/QueryTab.tsx
  src/components/query/QueryTab/Toolbar.tsx
  src/components/query/MongoQueryEditor.tsx` returns only deprecated
  comment references in `QueryTab.tsx` (sentence about the now-gone
  derivation) — no live `queryMode` / `onSetQueryMode` symbol in the
  Mongo editor or Toolbar files; see grep results below under AC-10.
- **AC-04** (new tabs no `queryMode`, legacy load OK): store suite
  `workspaceStore — Sprint 309 queryMode backward-compat` with 4
  tests in `src/stores/workspaceStore.queryMode.test.ts`:
  - `addQueryTab on a document paradigm leaves queryMode undefined
    (Sprint 309)`.
  - `addQueryTab on an rdb paradigm still sets queryMode to 'sql'`
    (regression guard).
  - `loadPersistedWorkspaces tolerates a legacy document tab with
    queryMode='aggregate' (Sprint 309)`.
  - `loadPersistedWorkspaces tolerates a legacy document tab with
    queryMode='find' (Sprint 309)`.
- **AC-05** (`useMongoAutocomplete` unified): `useMongoAutocomplete.test.ts`
  signature change asserted by `accepts no arguments at all (default
  options)` plus the remaining 5 cases that all call the hook without
  `queryMode`. Hook now: `useMongoAutocomplete(opts?: { fieldNames?:
  readonly string[] }): Extension[]`.
- **AC-06** (type deprecated): `src/stores/workspaceStore/types.ts`
  `QueryTab.queryMode` carries the JSDoc:

  ```ts
  /**
   * @deprecated Sprint 309 (Phase 28 Slice A3) — Find/Aggregate toggle
   * removed from the editor surface, so the editor and toolbar no longer
   * consume this field. […]
   */
  queryMode?: QueryMode;
  ```

- **AC-07** (vitest exit 0 + baseline match): `pnpm vitest run` →
  282 test files, 3515 passed / 10 skipped. Baseline 3516 / 10 minus
  the deliberately deleted toggle-related cases (1 net case in
  `MongoQueryEditor.test.tsx` consolidation, 1 case in
  `QueryTab.dialect.test.tsx`, ~3 cases across find/aggregate aria
  flips in `QueryEditor.test.tsx`) plus 4 new store tests +
  `useMongoAutocomplete.test.ts` net delta nets to 3515. Final exit
  code 0.
- **AC-08** (tsc + lint + build): `pnpm tsc --noEmit` exit 0, `pnpm
  lint` exit 0, `pnpm build` exit 0 (vite emits dist/index-*.js
  bundle as usual; the long dynamic-import-not-split warnings are
  pre-existing and unrelated to Sprint 309).
- **AC-09** (`grep -rn "Find mode\|Aggregate mode"
  src/components/query/`): empty.
- **AC-10** (`grep -rn "queryMode"
  src/components/query/MongoQueryEditor.tsx
  src/components/query/QueryTab/Toolbar.tsx`): empty.

## Autonomous decisions made

- **D-04** — Drop the `queryMode` parameter from `useMongoAutocomplete`
  entirely (no `"unified"` sentinel). Lower call-site cost (3 callers
  cleaned up at compile time) + type system catches dead args.
  Underlying `createMongoCompletionSource` keeps `MongoQueryMode` for
  its own unit tests. (See
  `docs/archives/phases/retired/phase-28-decision-log.md#d-04`.)
- **D-05** — Make `QueryTab.queryMode` optional and drop the document
  `"find"` default in `addQueryTab`. Spec invariant ("신규 tab
  queryMode 미설정") is only expressible if the type allows undefined.
  IDE clean-up surface for Sprint A5 improves dramatically. Legacy
  persistence migration backfill kept intact (load-throw-free for
  legacy payloads). (See `docs/archives/phases/retired/phase-28-decision-log.md#d-05`.)

(both appended to `docs/archives/phases/retired/phase-28-decision-log.md` under the new
"Phase 28 Slice A3 (Sprint 309 — 2026-05-14)" header.)

## Tests added / modified / deleted

### Added
- `src/stores/workspaceStore.queryMode.test.ts` (4 cases) — new file
  pinning the Sprint 309 backward-compat contract:
  - `addQueryTab` document leaves `queryMode` undefined.
  - `addQueryTab` rdb still sets `"sql"`.
  - `loadPersistedWorkspaces` tolerates legacy `queryMode:
    "aggregate"`.
  - `loadPersistedWorkspaces` tolerates legacy `queryMode: "find"`.

### Modified
- `src/components/query/MongoQueryEditor.test.tsx` — consolidated the
  two find/aggregate aria-label cases into one
  `renders with the unified MongoDB aria-label and JSON language
  (Sprint 309)`; remaining cases (highlight, Mod-Enter binding,
  reconfigure-in-place, completion source guards) updated to drop the
  `queryMode` prop from every render call and use the single
  `"MongoDB Query Editor"` label.
- `src/components/query/QueryEditor.test.tsx` — `queryMode` prop
  dropped from `<QueryEditor … paradigm="document" …>` call sites;
  aria-label flipped to the unified `"MongoDB Query Editor"`.
  Deleted: `"uses JSON for document paradigm + aggregate mode"` (was
  asserting `data-query-mode="aggregate"`) and `"flips the aria-label
  when paradigm changes"` (was flipping find ↔ aggregate aria labels)
  — both no longer reachable behaviour.
- `src/components/query/QueryTab.document.test.tsx` — deleted the two
  Sprint-73 cases:
  - `"renders the Find | Aggregate toggle only for document paradigm"`
  - `"clicking the Aggregate toggle calls setQueryMode and flips tab
    state"`
  replaced with one regression guard `"does NOT render the Find /
  Aggregate toggle on either paradigm (Sprint 309)"`.
- `src/components/query/QueryTab.dialect.test.tsx` — deleted
  `"rebuilds mongoExtensions identity when queryMode flips
  find→aggregate"`. The fieldNames-driven identity test remains as
  the live regression guard for the hook's memo key.
- `src/hooks/useMongoAutocomplete.test.ts` — rewritten to track the
  new signature. Deleted "produces a new memo when queryMode flips".
  Kept memoisation + fieldNames identity + undefined-tolerance cases.
  Added `"accepts no arguments at all (default options)"`.

### Deleted (toggle-related RTL assertions)
- `screen.getByLabelText("Find mode")` / `screen.getByLabelText("Aggregate mode")`
  assertions in `QueryTab.document.test.tsx`.
- `data-query-mode="find"` / `data-query-mode="aggregate"` assertions
  in `MongoQueryEditor.test.tsx` and `QueryEditor.test.tsx`.
- Find/Aggregate aria-label flip cases in `QueryEditor.test.tsx`.

## Checks run

- `pnpm vitest run`: **exit 0** — 3515 passed / 10 skipped (282 test
  files). Baseline 3516 / 10. Net delta: +4 new store tests, −2
  document toggle tests, −1 dialect-flip test, −2 editor aria-flip
  tests (consolidated). All deletions are toggle-related per the
  contract's allowance.
- `pnpm tsc --noEmit`: **exit 0**.
- `pnpm lint`: **exit 0**.
- `pnpm build`: **exit 0** — `built in 2.87s`; emits
  `dist/index-*.js` as usual (pre-existing dynamic-import warnings
  unrelated to Sprint 309).
- `grep -rn "queryMode" src/components/query/MongoQueryEditor.tsx
  src/components/query/QueryTab/Toolbar.tsx`: **empty**.
- `grep -rn "Find mode\|Aggregate mode"
  src/components/query/`: **empty**.

## Residual risk

- **A5 (Sprint 311) interim state**:
  `src/components/query/QueryTab/useQueryExecution.ts` still branches
  on `tab.queryMode === "aggregate"` at line 692 (and at lines 220 /
  229 / 940 it threads `tab.queryMode` into history + cancel-token
  bookkeeping). New document tabs created post-Sprint 309 have
  `queryMode === undefined`, so the legacy aggregate check short-
  circuits to `false` and the dispatch falls through to `find`.
  Legacy persisted tabs that carry `"aggregate"` continue to route
  through `aggregateDocuments`. Sprint A5 will replace this entire
  branch with parser-driven dispatch via `parseMongoshExpression`.
- **`HistoryPanel.tsx` still tags history entries with the legacy
  `queryMode`** (out of scope for A3 per the brief). Mongo history
  entries from new tabs will record `queryMode: undefined`; legacy
  aggregate entries continue to record `"aggregate"`. Sprint A5 will
  rewrite this to record the parsed mongosh method name.
- **`QueryEditor.tsx` is unused in production** (only its own test
  imports it). I kept it building cleanly under the new contract so
  `pnpm test` / `pnpm tsc` stay green; a follow-up sprint can decide
  whether to delete the router or migrate `QueryTab.tsx` to use it.
- **`workspaceStore/persistence.ts` legacy migration still backfills**
  document tabs that lack `queryMode` with `"find"`. This is
  intentional — load-throw guarantee — and harmless because new tabs
  go through `addQueryTab` (no backfill). A future sprint can clear
  the backfill once `useQueryExecution` no longer reads the field.
- **`createMongoCompletionSource` (deep layer) still takes
  `MongoQueryMode`**. The hook hard-codes `"aggregate"` to it.
  `MongoQueryEditor.test.tsx` / `QueryEditor.test.tsx` continue to
  unit-test the deep layer with both modes; this preserves the test
  guards for the underlying dispatcher even though the hook layer
  has collapsed.

## Persisted handoff

Wrote this report to `docs/sprints/sprint-309/handoff.md`.
