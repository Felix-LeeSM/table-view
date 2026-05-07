# Sprint 234 — Implementation Findings

Sprint: 234 (Phase 27 sprint 9 — UX consolidation polish bundle)
Date: 2026-05-07

This document captures non-obvious implementation choices, surprises,
and lessons learned during the Sprint 234 implementation pass. The
contract + execution-brief drove the high-level decisions; this file
records the trade-offs that surfaced inside the implementation.

## Things that went smoothly

### Backend `COMMENT ON TABLE` emit
The contract's locked decision to insert the table-level comment FIRST
in the `comment_stmts` vec aligned perfectly with the existing
Sprint 227 codepath. The new branch is 11 LOC including the
`#[serde(default)]` doc-comment; the rest of the chain (multi-statement
join with `;\n`, transaction loop, rollback policy) Just Worked.

### `usePostgresTypes.typesByName` additive surface
Pure-additive hook field — no breaking changes. Existing 12 vitest
cases (Sprint 230) keep passing untouched. The `mergeTypesByName`
helper mirrors `mergeTypes` 1:1 so the canonical-first / live-extras
ordering invariant carries cleanly.

### `IndexesTabBody` reorder
Single new prop (`onMove`) + 2 buttons + `position` index in `.map()`
+ boundary booleans. The existing Sprint 228 component shape made the
diff very small.

## Things that needed adjustment

### 1. Bulk-update of `CreateTableRequest` test struct literals
**Problem**: 16 existing Rust test struct literals in
`mutations.rs` needed `table_comment: None,` added (Rust requires all
struct fields explicitly in literal syntax). My first pass used a
regex that accidentally matched 52 sites — including `AlterTableRequest`
/ `CreateIndexRequest` / `AddConstraintRequest` literals (because they
all end with a `preview_only:` line followed by `};`).

**Fix**: Reverted with `git checkout`, then wrote a brace-tracking
Python script that anchors on `let req = CreateTableRequest {` opening
and walks the brace nesting to find the matching `};`. 16 patches
applied surgically. No collateral damage on other request types.

**Lesson**: When patching multi-line Rust literals via regex, anchor
on the type-named opening brace (`<TypeName> {`) and use brace
tracking, not pattern matching on closing braces.

### 2. `text-[10px]` blocked by ESLint rule
**Problem**: My initial badge implementation used the literal Tailwind
arbitrary value `text-[10px]`. The project's `tv-local/no-tailwind-
arbitrary-px` rule blocks arbitrary pixel values on size/spacing
utilities — they must use named design tokens.

**Fix**: `src/index.css` already defines `--text-3xs: 0.625rem; /*
10px */`. Replaced all 3 occurrences of `text-[10px]` with `text-3xs`
via `Edit` replace_all.

**Lesson**: Check `src/index.css` for available `--text-*` /
`--spacing-*` design tokens before reaching for arbitrary Tailwind
values. The project takes the no-arbitrary-px rule seriously.

### 3. Tab badge accessible name regex
**Problem**: The `(N)` badge sits inside a sibling `<span class="ml-1
text-3xs ...">(1)</span>` next to the literal "Keys" text. Testing
Library's accessible-name computation glues these together as a single
string — but the `ml-1` margin is purely visual, NOT a text-node space.
Result: `screen.getByRole("tab", { name: /^Keys \(1\)/ })` (with the
literal space inside the regex) FAILS. The actual accessible name is
`"Keys(1)"`.

**Fix**: Loosened the regex to `/^Keys.*\(1\)/` which matches both
"Keys(1)" and (hypothetical) "Keys (1)" variants.

**Lesson**: Tailwind margin classes don't insert text-node whitespace.
When asserting on accessible names that span multiple JSX children,
use `.*` between the literal segments.

### 4. `/Keys/` regex matched both "Keys" and "Foreign Keys" tabs
**Problem**: The first cut of the empty-state assertion used
`screen.getByRole("tab", { name: /Keys/ })` — this matched BOTH the
"Keys" tab and the "Foreign Keys" tab, throwing
"Found multiple elements".

**Fix**: Anchor the regex with `^` — `/^Keys/` matches only "Keys" and
"Keys(1)" / "Keys(2)" etc., never "Foreign Keys".

**Lesson**: When tab labels are sub-strings of each other, anchor with
`^` or `$`.

### 5. TypeScript narrowing on `let resolveFetch: …| null = null`
**Problem**: A new vitest case for the deferred Promise pattern was
declared as `let resolveFetch: ... | null = null;` then assigned
inside a `Promise` constructor. TypeScript (4.x+) narrows the type to
`null` at the call site (line 368) because the assignment inside the
constructor closure is treated as not yet reachable.

**Fix**: Cast at the assignment site:
`resolveFetch = resolve as (v: PostgresTypeInfo[]) => void;` then cast
again at the call site to suppress the residual narrow.

**Lesson**: This is a known TS gotcha for deferred Promise patterns
inside hooks tests. The Sprint 230 test file already had a workaround
that avoided the issue by using `resolveFetch?.([])` directly inside
an `act` — the simpler pattern would be to wrap the call in `act` from
the start.

## Trade-off escape hatches NOT taken

The execution brief mentioned three escape hatches; none were needed:

1. **`..Default::default()` for Rust struct literals** — Generator
   instead used the brace-tracking Python script, which is precise and
   leaves no follow-up `Default` derive churn. `CreateTableRequest` is
   not a `Default`-derivable struct (would need `Default` for
   `Vec<ColumnDefinition>` semantics → empty vec, which would silently
   accept zero-column requests at the type level — undesirable).
2. **`ChevronUp` / `ChevronDown` fallback** — `ArrowUp` / `ArrowDown`
   were available in `lucide-react` (already imported elsewhere), so
   used those per the contract's preferred recommendation.
3. **Fixed-height wrapper for tab badges** — the badge spans flow
   naturally inside the trigger without breaking tab strip height.
   No CSS workaround needed.

## Test naming convention

All new vitest cases include the AC tag in their `it()` description
(`(AC-234-01)`, `(AC-234-08)`, etc.) so the contract's
"vitest filter `AC-234`" verification works. The cargo fixtures
follow the existing Sprint 226-227 byte-equivalent naming convention
(`create_table_preview_<scenario>_byte_equivalent`).

## Performance / bundle size impact

Production bundle grew from baseline by ~6 KB (1,210 KB → 1,216 KB
gzipped: ~362 KB). Drivers:

- `mergeTypesByName` + `canonicalKindMap` helpers (~0.3 KB)
- `colorClassForTypeKind` switch + dot span JSX (~0.2 KB)
- `Header.tsx` strip (-0.5 KB)
- `CreateTableDialog.tsx` body restructure + reorder handlers + tab
  badges + table comment input (~5 KB)
- `IndexesTabBody.tsx` + `ForeignKeysTabBody.tsx` reorder
  buttons + 4 empty-state string changes (~1 KB)

No runtime perf regressions expected — the reorder swap is O(n) on the
state list (~1-30 entries typically), and the typesByName Map lookup
is O(1).

## Files touched outside the contract's listed modify set

None. All edits stay within the explicit modify list per the contract
§Frozen / Out of Scope. Frozen file diff = 0 verified.

## Follow-up sprints (deferred)

- DEFERRABLE / INITIALLY DEFERRED FK options (Sprint 235+)
- ON DELETE / ON UPDATE for indexes (Sprint 230+ deferred)
- CHECK expression multi-line / textarea (Sprint 235+)
- SQL editor for CHECK expression syntax highlighting (Sprint 235+)
- Drag-and-drop reorder (requires `@dnd-kit/sortable` primitive)
- Type-coloring legend / tooltip
- MySQL / MariaDB / SQLite / Oracle adapters (Phase 17-20)
- `invalidatePostgresTypesCache` lifecycle wire (Sprint 231+ wiring;
  the helper exists in Sprint 230 already but isn't called from the
  connection lifecycle yet)
