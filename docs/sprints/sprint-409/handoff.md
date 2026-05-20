# sprint-409 handoff

## Summary

Migrated the remaining public query/document/connection wire payloads to
camelCase, added frontend boundary normalizers for legacy snake_case payloads,
and kept intentionally snake_case schema/table-data/storage surfaces intact.

## Changed Areas

- Rust wire models:
  - `src-tauri/src/models/query.rs`
  - `src-tauri/src/db/types.rs`
  - `src-tauri/src/models/connection.rs`
  - `src-tauri/src/commands/connection/io.rs`
  - `src-tauri/tests/snapshot_shape.rs`
- Frontend wire normalization:
  - `src/lib/wireCamelCase.ts`
  - `src/lib/tauri/query.ts`
  - `src/lib/tauri/document.ts`
  - `src/lib/tauri/connection.ts`
  - `src/lib/snapshot/loadAll.ts`
  - `src/hooks/useConnectionSessionHydration.ts`
  - `src/hooks/useDryRun.ts`
- Canonical frontend types:
  - `src/types/query.ts`
  - `src/types/document.ts`
  - `src/types/documentMutate.ts`
  - `src/types/connection.ts`
- Store/UI consumers:
  - query/document result grids
  - connection dialog/list/workspace consumers
  - document store cache paths

## Guardrails

- `QueryType.dml.rows_affected` remains unchanged.
- `ColumnInfo.data_type` and `TableData.total_count` remain unchanged and are
  explicitly mapped from camelCase document/query payloads where needed.
- `ConnectionConfigPublic` emits camelCase but accepts legacy snake_case
  import/export JSON through serde aliases.
- Runtime snapshot/session hydration normalizes legacy `active_db` to
  `activeDb`.
- Dry-run preview normalizes wrapper-mocked legacy result payloads before
  rendering rows affected.

## Validation

- `pnpm exec tsc --noEmit`
- `pnpm build`
- `pnpm test` (`377` files, `4400` passed, `11` skipped)
- `pnpm lint` (`0` errors, existing max-lines warnings only)
- `pnpm exec prettier --check src/hooks/useDryRun.ts src/lib/wireCamelCase.ts`
- `git diff --check`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml --test snapshot_shape`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
- `pnpm vitest run src/components/workspace/ConfirmDestructiveDialog.test.tsx -t "AC-247-D8"`
- Flake loop:
  `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx -t "changing the Target schema dropdown updates the Tauri payload schema field on next preview"` passed 20/20.
- Flake loop:
  `pnpm vitest run src/lib/sql/updateColumnCompletion.test.ts -t "offers column candidates inside INSERT INTO users"` passed 30/30.

## Notes

- Full `pnpm format:check` still reports pre-existing formatting drift in
  `src/themes.css` and `src-tauri/AppIcon.icon/icon.json`; sprint-owned files
  pass targeted Prettier checks.
