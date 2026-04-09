# Sprint Execution Brief: Sprint 3

## Objective

- Upgrade the 2-state (null/ASC) column sort in DataGrid to a full 3-state toggle (null -> ASC -> DESC -> null) so users can sort data in descending order.

## Task Why

- The current implementation only supports toggling between sorted (ASC) and unsorted. Users cannot sort in descending order, which is a fundamental table viewing capability. This is the most impactful UX gap in the data grid.

## Scope Boundary

- **In**: DataGrid sort state refactor, header indicator logic, toolbar text, Rust ORDER BY direction parsing
- **Out**: Multi-column sort, SQLite/MySQL adapter changes, new Tauri command parameters, filter changes, query editor

## Invariants

1. `cargo clippy --all-targets --all-features -- -D warnings` passes
2. `cargo test` passes (49 tests)
3. `pnpm test` passes (29 tests)
4. `pnpm build` succeeds
5. No `any` types
6. SQL injection prevention maintained (column validation + direction whitelist in Rust)
7. Page resets to 1 on sort change (existing behavior)
8. Backward compatible: bare column name in `order_by` defaults to ASC

## Done Criteria

1. `DataGrid.tsx` state changed from `sortColumn: string | null` to `sort: { column: string; direction: "ASC" | "DESC" } | null`
2. `handleSort` implements 3-state cycle: clicking same column goes unsorted -> ASC -> DESC -> unsorted; clicking different column sets ASC
3. Column headers show ▲ for ASC, ▼ for DESC, nothing for unsorted
4. Toolbar text shows "Sorted by {column} ASC" or "Sorted by {column} DESC"
5. `fetchData` passes `"${column} ${direction}"` as `orderBy` to the Tauri command
6. `postgres.rs` parses `order_by` string to extract column name and direction; validates column against schema and direction against `["ASC", "DESC"]` whitelist
7. All 4 required checks pass (clippy, cargo test, pnpm test, pnpm build)

## Verification Plan

- Profile: mixed (command + static)
- Required checks:
  1. `cd /Users/felix/Desktop/study/view-table/src-tauri && cargo clippy --all-targets --all-features -- -D warnings` (exit 0)
  2. `cd /Users/felix/Desktop/study/view-table/src-tauri && cargo test` (49 passed, 0 failed)
  3. `cd /Users/felix/Desktop/study/view-table && pnpm test` (29 passed, 0 failed)
  4. `cd /Users/felix/Desktop/study/view-table && pnpm build` (exit 0)
- Required evidence:
  - Full stdout/stderr of each check command
  - Code snippets showing 3-state handleSort logic
  - Code snippets showing ▲/▼ indicator rendering
  - Code snippets showing toolbar text with direction
  - Code snippets showing Rust direction parsing with whitelist

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes
- Done criteria coverage with evidence
- Assumptions made during implementation
- Residual risk or verification gaps

## References

- Contract: `/Users/felix/Desktop/study/view-table/.claude/skills/harness/sprint-3/contract.md`
- Findings: (to be filled during execution)
- Relevant files:
  - `src/components/DataGrid.tsx` (sort state, handleSort, header rendering, toolbar text)
  - `src/lib/tauri.ts` (queryTableData bridge -- no signature change, verify pass-through)
  - `src/stores/schemaStore.ts` (queryTableData pass-through -- no change expected)
  - `src-tauri/src/db/postgres.rs` (ORDER BY direction parsing in `query_table_data`)
  - `src-tauri/src/commands/schema.rs` (Tauri command -- no change expected)

## Implementation Notes

### DataGrid.tsx changes

**State** (line 25):
```tsx
// Before
const [sortColumn, setSortColumn] = useState<string | null>(null);

// After
const [sort, setSort] = useState<{ column: string; direction: "ASC" | "DESC" } | null>(null);
```

**handleSort** (lines 79-82):
```tsx
// Before
const handleSort = (columnName: string) => {
  setSortColumn((prev) => (prev === columnName ? null : columnName));
  setPage(1);
};

// After -- 3-state cycle
const handleSort = (columnName: string) => {
  setSort((prev) => {
    if (prev === null || prev.column !== columnName) {
      return { column: columnName, direction: "ASC" as const };
    }
    if (prev.direction === "ASC") {
      return { column: columnName, direction: "DESC" as const };
    }
    return null; // DESC -> clear
  });
  setPage(1);
};
```

**Header indicator** (lines 211-213):
```tsx
// Before
{sortColumn === col.name && (
  <span className="text-(--color-accent)">&#9650;</span>
)}

// After
{sort?.column === col.name && sort.direction === "ASC" && (
  <span className="text-(--color-accent)">&#9650;</span>
)}
{sort?.column === col.name && sort.direction === "DESC" && (
  <span className="text-(--color-accent)">&#9660;</span>
)}
```

**Toolbar text** (lines 104-108):
```tsx
// Before
{sortColumn && (
  <span className="text-(--color-text-muted)">
    Sorted by {sortColumn}
  </span>
)}

// After
{sort && (
  <span className="text-(--color-text-muted)">
    Sorted by {sort.column} {sort.direction}
  </span>
)}
```

**fetchData orderBy** (line 55):
```tsx
// Before
sortColumn ?? undefined,

// After
sort ? `${sort.column} ${sort.direction}` : undefined,
```

**useCallback deps** (line 68):
```tsx
// Before
sortColumn,

// After
sort,
```

### postgres.rs changes

**ORDER BY parsing** (lines 323-329):
```rust
// Before
let mut order_clause = String::new();
if let Some(col) = &order_by {
    let valid_col = columns.iter().any(|c| c.name.as_str() == *col);
    if valid_col {
        order_clause = format!(" ORDER BY \"{}\" ASC", col.replace('"', "\"\""));
    }
}

// After
let mut order_clause = String::new();
if let Some(order_spec) = &order_by {
    let parts: Vec<&str> = order_spec.split_whitespace().collect();
    let (col_name, direction) = match parts.as_slice() {
        [col] => (*col, "ASC"),
        [col, dir] => {
            let upper = dir.to_uppercase();
            if upper != "ASC" && upper != "DESC" {
                // Invalid direction; skip ORDER BY
                (col_name, direction) // handled below as no-op
            } else {
                (*col, upper.as_str())
            }
        }
        _ => {
            // Malformed; skip ORDER BY
            // (col_name, direction remain uninitialized -- use outer approach)
        }
    };
    // Need to restructure with proper control flow
}
```

Recommended cleaner approach:
```rust
let mut order_clause = String::new();
if let Some(order_spec) = &order_by {
    let parts: Vec<&str> = order_spec.split_whitespace().collect();
    let (col_name, direction) = match parts.as_slice() {
        [col] => (*col, "ASC"),
        [col, dir] if ["ASC", "DESC"].contains(&dir.to_uppercase().as_str()) => {
            (*col, dir.to_uppercase().as_str())
        }
        _ => {
            // Invalid format or direction; skip ORDER BY
            col_name = "";
            direction = "";
        }
    };
    if !col_name.is_empty() {
        let valid_col = columns.iter().any(|c| c.name.as_str() == col_name);
        if valid_col {
            order_clause = format!(
                " ORDER BY \"{}\" {}",
                col_name.replace('"', "\"\""),
                direction
            );
        }
    }
}
```

**Important**: The implementation must use a clean approach where invalid direction or malformed input simply skips the ORDER BY clause. Column validation against the schema remains. Direction is only accepted from the `["ASC", "DESC"]` whitelist.
