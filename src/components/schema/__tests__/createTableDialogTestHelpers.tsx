// Shared harness for CreateTableDialog contract suites.
// Split from CreateTableDialog.test.tsx for issue #773.
import { vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { configure, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Sprint 385 (2026-05-17) — `waitFor` default timeout 1000ms 가 pre-push 의
// `pnpm test --coverage` (instrumentation + 4000+ test 병렬 부하) 하에서 본
// 파일의 AC-229 긴 DDL-chain 시나리오에 부족. 본 파일만 5000ms 로 늘려 CI
// 부하 hidden margin 회복. 다른 test 파일 영향 0.
configure({ asyncUtilTimeout: 5000 });

// These AC-229 cases intentionally drive multi-step tab switching, debounced
// preview, and chained IPC mocks. Full-suite coverage instrumentation can push
// them past Vitest's global 10s test timeout even though the assertions pass in
// isolated runs.
export const PRE_PUSH_LOAD_TEST_TIMEOUT_MS = 30000;
export const STALE_INDEX_PLACEHOLDER = ["Available in", "Sprint 228"].join(" ");
export const STALE_CONSTRAINTS_PLACEHOLDER = [
  "Available in",
  "Sprint 229",
].join(" ");

const createTableDialogMocks = vi.hoisted(() => ({
  mockCreateTable: vi.fn(),
  mockCreateIndex: vi.fn(),
  // Sprint 228 — declared so a vitest spy can assert that the chain
  // does NOT call dropIndex on mid-chain failure (AC-228-07). Not
  // exported in production, but the mock surface needs to expose it
  // so the test can `expect(mockDropIndex).not.toHaveBeenCalled()`.
  mockDropIndex: vi.fn(),
  // Sprint 229 — addConstraint chain is the new ADD CONSTRAINT × K
  // step appended after the Sprint 228 createIndex × M chain. mock
  // dropConstraint is exposed so AC-229-08 can assert no rollback
  // on mid-chain failure.
  mockAddConstraint: vi.fn(),
  mockDropConstraint: vi.fn(),
  // Sprint 240 — `createTablePlan` is the new unified IPC the dialog
  // calls in place of the Sprint 228/229 N+1 fan-out. The default
  // impl below routes the plan through `mockCreateTable` /
  // `mockCreateIndex` / `mockAddConstraint` so the existing
  // fan-out-shaped assertions (call counts, ordering, rejection
  // halts the chain) keep validating the same contract. The
  // backend's trait default impl mirrors this exact fan-out, so
  // the simulation is faithful — not an arbitrary test seam.
  mockCreateTablePlan: vi.fn(),
  // Sprint 230 — usePostgresTypes consumes this. Default impl returns
  // an empty array so non-Sprint-230 cases see the canonical-only
  // merged list (= canonical exactly).
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

// Sprint 240 — wire `createTablePlan` to the legacy fan-out mocks. The
// production code now issues exactly one IPC per debounce flush, but
// the test asserts the per-step shape (call counts on `createTable` /
// `createIndex` / `addConstraint`, order, propagated rejection). This
// impl keeps those asserts valid by replaying the same chain the
// backend's default `RdbAdapter::create_table_plan` would have run.
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
        // Sprint 240 — wrap rejection with the failing index name so
        // the dialog's preview pane surfaces "Index \"idx_x\" failed:
        // ...". Mirrors the backend `create_table_plan` default impl
        // (`db/traits.rs`).
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
    // Sprint 247 — `<DryRunPreview>` IPC stub for confirm dialog.
    executeQueryDryRun: vi.fn(() => Promise.resolve([])),
    cancelQuery: vi.fn(() => Promise.resolve("cancelled")),
  });
});

import CreateTableDialog from "../CreateTableDialog";
import { useConnectionStore } from "@stores/connectionStore";

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // Sprint 263 — schemaStore caches are now `(connId, db)` keyed; the
  // dialog needs the active db to look up FK reference candidates.
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

// Sprint 241 — the Constraints panel splits FK / CHECK / UNIQUE into
// a nested uncontrolled `<Tabs defaultValue="fk">`. Radix Tabs in
// uncontrolled mode does NOT react to bare `fireEvent.click`; it
// requires the pointer-event sequence that `userEvent` synthesises.
export async function activateConstraintSubTab(
  name: "Foreign Keys" | "CHECK" | "UNIQUE",
) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: new RegExp(`^${name}`) }));
}
