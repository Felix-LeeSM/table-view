// Shared harness for CreateTableDialog contract suites.
// Split from CreateTableDialog.test.tsx for issue #773.

import { configure, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";

// `waitFor`'s default 1000ms timeout is not enough for this file's AC-229
// long DDL-chain scenarios under a full-suite coverage run (`pnpm test
// --coverage`, instrumentation plus parallel load). 5000ms here alone
// restores the margin under CI load; no other test file is affected.
configure({ asyncUtilTimeout: 5000 });

// These AC-229 cases intentionally drive multi-step tab switching, debounced
// preview, and chained IPC mocks. Full-suite coverage instrumentation can push
// them past Vitest's global 10s test timeout even though the assertions pass in
// isolated runs.
export const HEAVY_LOAD_TEST_TIMEOUT_MS = 30000;
export const STALE_INDEX_PLACEHOLDER = ["Available in", "Sprint 228"].join(" ");
export const STALE_CONSTRAINTS_PLACEHOLDER = [
  "Available in",
  "Sprint 229",
].join(" ");

const createTableDialogMocks = vi.hoisted(() => ({
  mockCreateTable: vi.fn(),
  mockCreateIndex: vi.fn(),
  // Declared so a vitest spy can assert that the chain does NOT call
  // dropIndex on mid-chain failure (AC-228-07). Not exported in
  // production, but the mock surface needs to expose it so the test can
  // `expect(mockDropIndex).not.toHaveBeenCalled()`.
  mockDropIndex: vi.fn(),
  // The addConstraint chain is the ADD CONSTRAINT × K step appended
  // after the createIndex × M chain. mock dropConstraint is exposed so
  // AC-229-08 can assert no rollback on mid-chain failure.
  mockAddConstraint: vi.fn(),
  mockDropConstraint: vi.fn(),
  // `createTablePlan` is the unified IPC the dialog calls in place of
  // the N+1 fan-out. The default impl below routes the plan through
  // `mockCreateTable` / `mockCreateIndex` / `mockAddConstraint` so the
  // fan-out-shaped assertions (call counts, ordering, rejection halts
  // the chain) keep validating the same contract. The backend's trait
  // default impl mirrors this exact fan-out, so the simulation is
  // faithful — not an arbitrary test seam.
  mockCreateTablePlan: vi.fn(),
  // usePostgresTypes consumes this. Default impl returns an empty array
  // so other cases see the canonical-only merged list (= canonical
  // exactly).
  mockListPostgresTypes: vi.fn().mockResolvedValue([]),
}));

export const {
  mockCreateTable,
  mockCreateIndex,
  mockDropIndex,
  mockAddConstraint,
  mockDropConstraint,
  mockCreateTablePlan,
  mockListPostgresTypes,
} = createTableDialogMocks;

// Wire `createTablePlan` to the legacy fan-out mocks. The production
// code issues exactly one IPC per debounce flush, but the test asserts
// the per-step shape (call counts on `createTable` / `createIndex` /
// `addConstraint`, order, propagated rejection). This impl keeps those
// asserts valid by replaying the same chain the backend's default
// `RdbAdapter::create_table_plan` would have run.
mockCreateTablePlan.mockImplementation(
  async (req: {
    connectionId: string;
    schema: string;
    name: string;
    columns: unknown[];
    primaryKey?: string[] | null;
    tableComment?: string | null;
    indexes?: Array<{
      indexName: string;
      columns: string[];
      indexType: string;
      isUnique?: boolean;
    }>;
    constraints?: Array<{
      constraintName: string;
      definition: unknown;
    }>;
    previewOnly?: boolean;
  }) => {
    const previewOnly = req.previewOnly ?? false;
    const sqlParts: string[] = [];
    const tableResult = await mockCreateTable({
      connection_id: req.connectionId,
      schema: req.schema,
      name: req.name,
      columns: req.columns,
      primary_key: req.primaryKey ?? null,
      table_comment: req.tableComment ?? null,
      preview_only: previewOnly,
    });
    sqlParts.push((tableResult as { sql?: string }).sql ?? "");
    for (const idx of req.indexes ?? []) {
      try {
        const r = await mockCreateIndex({
          connection_id: req.connectionId,
          schema: req.schema,
          table: req.name,
          index_name: idx.indexName,
          columns: idx.columns,
          index_type: idx.indexType,
          is_unique: idx.isUnique ?? false,
          preview_only: previewOnly,
        });
        sqlParts.push((r as { sql?: string }).sql ?? "");
      } catch (e) {
        // Wrap the rejection with the failing index name so the dialog's
        // preview pane surfaces "Index \"idx_x\" failed: ...". Mirrors the
        // backend `create_table_plan` default impl (`db/traits.rs`).
        throw new Error(`Index "${idx.indexName}" failed: ${String(e)}`);
      }
    }
    for (const c of req.constraints ?? []) {
      try {
        const r = await mockAddConstraint({
          connection_id: req.connectionId,
          schema: req.schema,
          table: req.name,
          constraint_name: c.constraintName,
          definition: c.definition,
          preview_only: previewOnly,
        });
        sqlParts.push((r as { sql?: string }).sql ?? "");
      } catch (e) {
        throw new Error(
          `Constraint "${c.constraintName}" failed: ${String(e)}`,
        );
      }
    }
    return { sql: sqlParts.filter((s) => s.length > 0).join(";\n") };
  },
);
beforeEach(() => {
  setupTauriMock({
    createTable: mockCreateTable,
    createTablePlan: mockCreateTablePlan,
    createIndex: mockCreateIndex,
    dropIndex: mockDropIndex,
    addConstraint: mockAddConstraint,
    dropConstraint: mockDropConstraint,
    listPostgresTypes: mockListPostgresTypes,
    // `<DryRunPreview>` IPC stub for the confirm dialog.
    executeQueryDryRun: vi.fn(() => Promise.resolve([])),
    cancelQuery: vi.fn(() => Promise.resolve("cancelled")),
  });
});

import { useConnectionStore } from "@stores/connectionStore";
import CreateTableDialog from "../CreateTableDialog";

export function setProductionConnection() {
  useConnectionStore.setState({
    connections: [
      {
        id: "conn-1",
        name: "prod",
        dbType: "postgres",
        host: "localhost",
        port: 5432,
        database: "app",
        username: "u",
        password: null,
        environment: "production",
      } as any,
    ],
  });
}

export function setDevConnection() {
  useConnectionStore.setState({
    connections: [
      {
        id: "conn-1",
        name: "dev",
        dbType: "postgres",
        host: "localhost",
        port: 5432,
        database: "app",
        username: "u",
        password: null,
        environment: "development",
      } as any,
    ],
  });
}

export function renderDialog(
  overrides: Partial<{
    onClose: () => void;
    onRefresh: () => Promise<void>;
    schemaName: string;
    availableSchemas: string[];
    database: string;
  }> = {},
) {
  const onClose = overrides.onClose ?? vi.fn();
  const onRefresh = overrides.onRefresh ?? vi.fn().mockResolvedValue(undefined);
  const schemaName = overrides.schemaName ?? "public";
  const availableSchemas = overrides.availableSchemas;
  // schemaStore caches are `(connId, db)` keyed; the dialog needs the
  // active db to look up FK reference candidates.
  const database = overrides.database ?? "db-1";
  const view = render(
    <CreateTableDialog
      connectionId="conn-1"
      database={database}
      schemaName={schemaName}
      availableSchemas={availableSchemas}
      open
      onClose={onClose}
      onRefresh={onRefresh}
    />,
  );
  return { ...view, onClose, onRefresh };
}

export function getColumnsPanel(): HTMLElement {
  // Tabs primitive renders inactive panels with hidden=true; the
  // active panel has data-state="active". Scope queries to the active
  // Columns panel so we don't pick up the Keys-tab PK label list.
  return document.querySelector(
    '[data-testid="create-table-columns-panel"]',
  ) as HTMLElement;
}

export function getKeysPanel(): HTMLElement {
  return document.querySelector(
    '[data-testid="create-table-keys-panel"]',
  ) as HTMLElement;
}

export function activateTab(label: string) {
  // The outer (main) Tabs in `CreateTableDialog` is controlled
  // (`value` + `onValueChange`), so a single `fireEvent.click` on the
  // trigger flips state via React. The first matching tab is the main
  // tablist's trigger — sub-tabs (FK / CHECK / UNIQUE inside the
  // Constraints panel) have non-overlapping labels.
  const tab = screen.getAllByRole("tab", { name: label })[0];
  if (!tab) throw new Error(`No tab with label ${label}`);
  fireEvent.click(tab);
}

// The Constraints panel splits FK / CHECK / UNIQUE into a nested
// uncontrolled `<Tabs defaultValue="fk">`. Radix Tabs in
// uncontrolled mode does NOT react to bare `fireEvent.click`; it
// requires the pointer-event sequence that `userEvent` synthesises.
export async function activateConstraintSubTab(
  name: "Foreign Keys" | "CHECK" | "UNIQUE",
) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: new RegExp(`^${name}`) }));
}
