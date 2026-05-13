// Sprint 220 — shared helpers extracted from `StructurePanel.test.tsx`
// (P11 step 3) so the behaviour-axis test files can reuse the same
// `vi.fn()` instances + 3 fixture constants + 2 helper functions + the
// `beforeEach` body. The 3 mock functions, the `MOCK_*` fixtures, and
// the `setStoreState` / `renderPanel` / `resetStructurePanelMocks`
// helpers mirror the original mega-test verbatim — no behaviour change.
// Each axis file imports these and re-applies them in its own
// `beforeEach` so worker-per-file isolation + `clearAllMocks()` keep
// state from leaking across cases.
//
// Unlike Sprint 218 (QueryTab.test) — which had 7 hoisted
// `vi.mock(...)` factories that cannot live in a helper module — this
// mega-test has 0 `vi.mock(...)` factories. The 5 `vi.spyOn(tauri, ...)`
// calls in `beforeEach` are not hoisted by ES module rules and live in
// `resetStructurePanelMocks()` here without disturbing the original
// behaviour.
import { vi } from "vitest";
import { render } from "@testing-library/react";
import StructurePanel from "../StructurePanel";
import { useSchemaStore } from "@stores/schemaStore";
import type {
  ColumnInfo,
  ConstraintInfo,
  IndexInfo,
  TriggerInfo,
} from "@/types/schema";
import * as tauri from "@lib/tauri";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

export const MOCK_COLUMNS: ColumnInfo[] = [
  {
    name: "id",
    data_type: "integer",
    nullable: false,
    default_value: null,
    is_primary_key: true,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  },
  {
    name: "name",
    data_type: "text",
    nullable: true,
    default_value: "'unknown'",
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: "User display name",
  },
  {
    name: "org_id",
    data_type: "bigint",
    nullable: false,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: true,
    fk_reference: "public.organizations(id)",
    comment: null,
  },
];

export const MOCK_INDEXES: IndexInfo[] = [
  {
    name: "users_pkey",
    columns: ["id"],
    index_type: "btree",
    is_primary: true,
    is_unique: true,
  },
  {
    name: "users_name_idx",
    columns: ["name"],
    index_type: "btree",
    is_primary: false,
    is_unique: false,
  },
  {
    name: "users_email_uniq",
    columns: ["email"],
    index_type: "hash",
    is_primary: false,
    is_unique: true,
  },
];

export const MOCK_CONSTRAINTS: ConstraintInfo[] = [
  {
    name: "users_pkey",
    constraint_type: "PRIMARY KEY",
    columns: ["id"],
    reference_table: null,
    reference_columns: null,
  },
  {
    name: "users_org_id_fkey",
    constraint_type: "FOREIGN KEY",
    columns: ["org_id"],
    reference_table: "organizations",
    reference_columns: ["id"],
  },
  {
    name: "users_email_notnull",
    constraint_type: "CHECK",
    columns: ["email"],
    reference_table: null,
    reference_columns: null,
  },
];

// ---------------------------------------------------------------------------
// Store mocking
// ---------------------------------------------------------------------------

export const MOCK_TRIGGERS: TriggerInfo[] = [
  {
    name: "audit_users_insert",
    schema: "public",
    table: "users",
    timing: "BEFORE",
    events: ["INSERT", "UPDATE"],
    orientation: "ROW",
    functionSchema: "audit",
    functionName: "log_change",
    arguments: "'users'",
    whenExpression: "(NEW.email IS NOT NULL)",
    definition:
      "CREATE TRIGGER audit_users_insert BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW WHEN (NEW.email IS NOT NULL) EXECUTE FUNCTION audit.log_change('users')",
  },
];

export const mockGetTableColumns = vi.fn().mockResolvedValue(MOCK_COLUMNS);
export const mockGetTableIndexes = vi.fn().mockResolvedValue(MOCK_INDEXES);
export const mockGetTableConstraints = vi
  .fn()
  .mockResolvedValue(MOCK_CONSTRAINTS);
// Sprint 272 — trigger fetcher mock. Default resolves with the canonical
// `MOCK_TRIGGERS` fixture; individual tests override per-call.
export const mockGetTableTriggers = vi.fn().mockResolvedValue(MOCK_TRIGGERS);

export function setStoreState(overrides: Record<string, unknown> = {}) {
  useSchemaStore.setState({
    getTableColumns: mockGetTableColumns,
    getTableIndexes: mockGetTableIndexes,
    getTableConstraints: mockGetTableConstraints,
    getTableTriggers: mockGetTableTriggers,
    ...overrides,
  } as Partial<Parameters<typeof useSchemaStore.setState>[0]>);
}

export function renderPanel(
  props: {
    connectionId?: string;
    database?: string;
    table?: string;
    schema?: string;
    initialSubTab?: "columns" | "indexes" | "constraints" | "triggers";
  } = {},
) {
  return render(
    <StructurePanel
      connectionId={props.connectionId ?? "conn-1"}
      database={props.database ?? "db-1"}
      table={props.table ?? "users"}
      schema={props.schema ?? "public"}
      initialSubTab={props.initialSubTab}
    />,
  );
}

// ---------------------------------------------------------------------------
// Store + mock reset helper (mirrors the original `beforeEach` body)
// ---------------------------------------------------------------------------

export function resetStructurePanelMocks(): void {
  vi.clearAllMocks();
  mockGetTableColumns.mockResolvedValue([...MOCK_COLUMNS]);
  mockGetTableIndexes.mockResolvedValue([...MOCK_INDEXES]);
  mockGetTableConstraints.mockResolvedValue([...MOCK_CONSTRAINTS]);
  // Sprint 272 — reset triggers mock between tests so a per-test
  // `.mockResolvedValueOnce(...)` doesn't leak into the next case.
  mockGetTableTriggers.mockResolvedValue([...MOCK_TRIGGERS]);
  setStoreState();
  vi.spyOn(tauri, "alterTable").mockResolvedValue({
    sql: "ALTER TABLE users ADD COLUMN email varchar(255);",
  });
  vi.spyOn(tauri, "createIndex").mockResolvedValue({
    sql: "CREATE INDEX idx_name ON public.users (name);",
  });
  vi.spyOn(tauri, "dropIndex").mockResolvedValue({
    sql: "DROP INDEX idx_name;",
  });
  vi.spyOn(tauri, "addConstraint").mockResolvedValue({
    sql: "ALTER TABLE public.users ADD CONSTRAINT uk_email UNIQUE (email);",
  });
  vi.spyOn(tauri, "dropConstraint").mockResolvedValue({
    sql: "ALTER TABLE public.users DROP CONSTRAINT uk_email;",
  });
}
