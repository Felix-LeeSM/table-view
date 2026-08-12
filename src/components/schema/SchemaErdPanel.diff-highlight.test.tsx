/**
 * Issue #1662 / ADR 0054 decision 6 — the schema diff marks the ERD canvas, not
 * only the `SchemaGraphDiffPanel` table. The join runs on
 * `SchemaGraphDiffEntry.tableIds`, which already holds ERD node ids.
 */
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { SchemaGraphDiffSummary } from "@/lib/schemaGraphDiff";
import { installReactFlowJsdomShims } from "@/test-utils/reactFlow";
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { DatabaseType } from "@/types/connection";
import type { ColumnInfo } from "@/types/schema";
import type { SchemaGraphSource } from "@/types/schemaGraph";

// Counting elkjs runs is how ADR 0056's reconcile promise stays reachable: a
// re-layout resets every node position, so a diff mark — pure presentation —
// must never trigger one.
vi.mock("./erdGraphModel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./erdGraphModel")>();
  return { ...actual, layoutErdModel: vi.fn(actual.layoutErdModel) };
});

import { buildErdDiffHighlight } from "./erdDiffHighlight";
import { layoutErdModel } from "./erdGraphModel";
import SchemaErdPanel from "./SchemaErdPanel";

/**
 * elkjs pays a one-off init cost on its first run and this file renders the
 * whole panel around the canvas, so a card can take far longer than RTL's 1s
 * default. `ERD_TEST_TIMEOUT_MS` lifts the 10s `testTimeout` from
 * `vite.config.ts` for the tests that wait on a real layout.
 */
const ERD_LAYOUT_TIMEOUT_MS = 15000;
const ERD_TEST_TIMEOUT_MS = 30000;

let restoreShims: () => void;

beforeAll(() => {
  restoreShims = installReactFlowJsdomShims();
});

afterAll(() => {
  restoreShims();
});

describe("SchemaErdPanel diff highlight", () => {
  beforeEach(() => {
    vi.mocked(layoutErdModel).mockClear();
    setupTauriMock({
      getTableIndexes: vi.fn(() => Promise.resolve([])),
      getTableConstraints: vi.fn(() => Promise.resolve([])),
      listSchemas: vi.fn(() => Promise.resolve([])),
      listTables: vi.fn(() => Promise.resolve([])),
      listSchemaColumns: vi.fn(() => Promise.resolve({})),
    });
    useConnectionStore.setState({
      connections: [
        connection("conn1", "Local Postgres", "postgresql", "app"),
        connection("conn2", "Staging MySQL", "mysql", "staging"),
      ],
      activeStatuses: { conn1: { type: "connected", activeDb: "app" } },
      focusedConnId: "conn1",
    });
    useSchemaStore.setState({
      schemas: {
        conn1: { app: [{ name: "public" }] },
        conn2: { staging: [{ name: "public" }] },
      },
      tables: {
        conn1: {
          app: {
            public: [
              { name: "users", schema: "public", row_count: null },
              { name: "audit_log", schema: "public", row_count: null },
            ],
          },
        },
        conn2: {
          staging: {
            public: [
              { name: "users", schema: "public", row_count: null },
              { name: "orders", schema: "public", row_count: null },
            ],
          },
        },
      },
      tableColumnsCache: {
        conn1: {
          app: {
            public: {
              // `id` differs by type from the comparison, `email` is new.
              users: [column("id", { is_primary_key: true }), column("email")],
              audit_log: [column("id", { is_primary_key: true })],
            },
          },
        },
        conn2: {
          staging: {
            public: {
              users: [
                column("id", { is_primary_key: true, data_type: "bigint" }),
                column("legacy_note"),
              ],
              orders: [column("id", { is_primary_key: true })],
            },
          },
        },
      },
      // Present-but-empty so the panel's metadata effects fetch nothing and the
      // diff stays a function of the columns above.
      tableIndexesCache: {
        conn1: { app: { public: { users: [], audit_log: [] } } },
        conn2: { staging: { public: { users: [], orders: [] } } },
      },
      tableConstraintsCache: {
        conn1: { app: { public: { users: [], audit_log: [] } } },
        conn2: { staging: { public: { users: [], orders: [] } } },
      },
      views: {},
      functions: {},
      postgresExtensions: {},
      sqliteCapabilities: {},
      triggers: {},
      loading: false,
      error: null,
    });
  });

  it(
    "marks each canvas card with the change kinds its diff entries carry",
    async () => {
      render(<SchemaErdPanel connectionId="conn1" database="app" />);
      const users = await findTableCard(/public\.users table/i);
      expect(users).not.toHaveAttribute("data-diff-kinds");

      await selectComparison();

      // Added table: only its own creation registers, so one kind and one mark.
      const auditLog = await screen.findByRole("button", {
        name: /public\.audit_log table/i,
      });
      expect(auditLog).toHaveAttribute("data-diff-kinds", "added");
      expect(
        within(auditLog).getByRole("img", { name: "Schema diff: Added" }),
      ).toBeInTheDocument();

      // Surviving table: a column gained, a column dropped, a column retyped.
      await waitFor(() => {
        expect(users).toHaveAttribute(
          "data-diff-kinds",
          "added removed changed",
        );
      });
      for (const kind of ["Added", "Removed", "Changed"]) {
        expect(
          within(users).getByRole("img", { name: `Schema diff: ${kind}` }),
        ).toBeInTheDocument();
      }
    },
    ERD_TEST_TIMEOUT_MS,
  );

  it(
    "marks the individual columns the diff touched",
    async () => {
      render(<SchemaErdPanel connectionId="conn1" database="app" />);
      const users = await findTableCard(/public\.users table/i);

      await selectComparison();

      await waitFor(() => {
        expect(
          within(users).getByRole("img", {
            name: /column email, schema diff: added/i,
          }),
        ).toBeInTheDocument();
      });
      expect(
        within(users).getByRole("img", {
          name: /column id, schema diff: changed/i,
        }),
      ).toBeInTheDocument();
    },
    ERD_TEST_TIMEOUT_MS,
  );

  it(
    "leaves a comparison-only table off the canvas and out of the marks",
    async () => {
      render(<SchemaErdPanel connectionId="conn1" database="app" />);
      await findTableCard(/public\.users table/i);

      await selectComparison();

      // `public.orders` exists only in the comparison snapshot, so the diff lists
      // it while the canvas — drawn from the current schema — has no card for it.
      expect(
        within(screen.getByRole("region", { name: /schema diff/i })).getByText(
          "public.orders",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /public\.orders table/i }),
      ).toBeNull();
    },
    ERD_TEST_TIMEOUT_MS,
  );

  // ADR 0056 (3) reconcile: new tables get auto-placed and hand-dragged ones are
  // restored. A mark that re-ran the layout would throw both away.
  it(
    "keeps the diff mark out of the layout input",
    async () => {
      const { container } = render(
        <SchemaErdPanel connectionId="conn1" database="app" />,
      );
      const users = await findTableCard(/public\.users table/i);
      await waitFor(() => {
        expect(vi.mocked(layoutErdModel).mock.calls.length).toBeGreaterThan(0);
      });
      const layoutRuns = vi.mocked(layoutErdModel).mock.calls.length;
      const placement = users
        .closest(".react-flow__node")
        ?.getAttribute("style");
      expect(placement).toMatch(/translate\(/);

      await selectComparison();
      await waitFor(() => {
        expect(users).toHaveAttribute("data-diff-kinds");
      });

      expect(vi.mocked(layoutErdModel)).toHaveBeenCalledTimes(layoutRuns);
      expect(users.closest(".react-flow__node")?.getAttribute("style")).toBe(
        placement,
      );
      expect(container.querySelectorAll(".react-flow__node")).toHaveLength(2);
    },
    ERD_TEST_TIMEOUT_MS,
  );

  it("highlights nothing for an entry that carries no tableIds", () => {
    const highlight = buildErdDiffHighlight(diffWithoutTableIds());

    expect(highlight.tables.size).toBe(0);
    expect(highlight.columns.get("table:public.users.column:email")).toBe(
      "added",
    );
  });

  it("highlights nothing without a comparison snapshot", () => {
    expect(buildErdDiffHighlight(null).tables.size).toBe(0);
    expect(buildErdDiffHighlight(undefined).columns.size).toBe(0);
  });
});

function findTableCard(name: RegExp) {
  return screen.findByRole(
    "button",
    { name },
    { timeout: ERD_LAYOUT_TIMEOUT_MS },
  );
}

async function selectComparison() {
  fireEvent.click(
    screen.getByRole("combobox", { name: /compare cached schema snapshot/i }),
  );
  fireEvent.click(
    await screen.findByRole("option", { name: /staging mysql \/ staging/i }),
  );
}

function connection(
  id: string,
  name: string,
  dbType: DatabaseType,
  database: string,
) {
  return {
    id,
    name,
    dbType,
    paradigm: "rdb",
    host: "localhost",
    port: 5432,
    user: "app",
    database,
    groupId: null,
    color: null,
    hasPassword: false,
  } as const;
}

function column(name: string, overrides: Partial<ColumnInfo> = {}): ColumnInfo {
  return {
    name,
    data_type: "integer",
    nullable: false,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
    ...overrides,
  };
}

/**
 * `tableIds` is optional on `SchemaGraphDiffEntry`. `selectSchemaGraphDiff`
 * always fills it today, so the omitted shape is built by hand here rather than
 * left unproven.
 */
function diffWithoutTableIds(): SchemaGraphDiffSummary {
  const entry = {
    id: "table:public.users.column:email",
    entityKind: "column",
    kind: "added",
    label: "public.users.email",
    changes: [],
  } as const;
  const empty = { added: [], removed: [], changed: [] };
  const groups = {
    tables: empty,
    columns: { added: [entry], removed: [], changed: [] },
    indexes: empty,
    constraints: empty,
    foreignKeys: empty,
  };
  const source: SchemaGraphSource = {
    dbType: "postgresql",
    database: "app",
  };

  return {
    source: { before: source, after: source },
    sameSource: true,
    groups,
    ...groups,
    totals: { added: 1, removed: 0, changed: 0, total: 1 },
  };
}
