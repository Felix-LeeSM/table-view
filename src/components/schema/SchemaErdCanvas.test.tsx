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
import { extractSchemaGraph } from "@/lib/schemaGraph";
import { selectSchemaGraphIntelligence } from "@/lib/schemaGraphSelectors";
import { installReactFlowJsdomShims } from "@/test-utils/reactFlow";
import type { ColumnInfo, TableInfo } from "@/types/schema";
import type { SchemaGraphCatalogSnapshot } from "@/types/schemaGraph";
import type { ErdDetailLevel } from "./erdGraphModel";

/**
 * Semantic-zoom level the canvas sees, pinned rather than fitted.
 *
 * jsdom measures the React Flow pane as 0x0, so React Flow substitutes its
 * 500x500 fallback and the mount-time `fitView` settles at `ERD_MIN_ZOOM`
 * (measured: 100% right after the first card paints, 15% ~100ms later). That
 * number is an artifact of the fallback size, not of anything a user would see,
 * and racing it would make every column assertion in this file depend on how
 * fast the machine is. So each test states the level it is standing at;
 * `null` hands the resolution back to the real function.
 */
const detail = vi.hoisted(() => ({ level: null as ErdDetailLevel | null }));

// Counting elkjs runs is the only way to assert the invariant that protects a
// user's dragged layout: re-running the layout resets every node position, so
// it must happen once per table/FK-set change and not once per metadata fetch.
vi.mock("./erdGraphModel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./erdGraphModel")>();
  return {
    ...actual,
    layoutErdModel: vi.fn(actual.layoutErdModel),
    erdDetailLevel: vi.fn((zoom: number) =>
      detail.level === null ? actual.erdDetailLevel(zoom) : detail.level,
    ),
  };
});

import { erdDetailLevel, layoutErdModel } from "./erdGraphModel";
import SchemaErdCanvas from "./SchemaErdCanvas";

let restoreShims: () => void;

/**
 * elkjs runs the layout asynchronously and its first call pays a one-off
 * initialization cost, so a card can take noticeably longer than RTL's 1s
 * default to appear on a loaded machine.
 */
const ERD_LAYOUT_TIMEOUT_MS = 5000;

function findTableCard(name: RegExp) {
  return screen.findByRole(
    "button",
    { name },
    { timeout: ERD_LAYOUT_TIMEOUT_MS },
  );
}

beforeAll(() => {
  restoreShims = installReactFlowJsdomShims();
});

afterAll(() => {
  restoreShims();
});

beforeEach(() => {
  detail.level = "full";
});

describe("SchemaErdCanvas", () => {
  it("renders elkjs-placed table nodes and FK edges from a SchemaGraph", async () => {
    render(<SchemaErdCanvas graph={extractSchemaGraph(ordersSnapshot())} />);

    expect(
      screen.getByRole("figure", { name: /database relationship diagram/i }),
    ).toBeInTheDocument();
    const orders = await findTableCard(/public\.orders table/i);
    expect(orders).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /public\.users table/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        "public.orders.user_id references public.users.id (1:N)",
      ),
    ).toBeInTheDocument();

    // elkjs positions land on the React Flow node wrapper, not on the card.
    const wrapper = orders.closest(".react-flow__node");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute("style")).toMatch(/translate\(/);
  });

  // Issue #2151: an edge that leaves the card as a whole cannot say which
  // column it came from, so the handle has to live in the column's own row.
  // jsdom measures every box as 0x0, so the row this asserts on is the DOM
  // parent — the coordinates it produces are covered by e2e, not here.
  it("anchors an FK edge on the column row rather than the card", async () => {
    render(<SchemaErdCanvas graph={extractSchemaGraph(ordersSnapshot())} />);

    const orders = await findTableCard(/public\.orders table/i);
    const fkRow = within(orders).getByText("user_id").closest("div");
    expect(
      fkRow?.querySelector('[data-handleid="erd-source:user_id"]'),
    ).not.toBeNull();

    const users = screen.getByRole("button", { name: /public\.users table/i });
    const pkRow = within(users).getByText("id").closest("div");
    expect(
      pkRow?.querySelector('[data-handleid="erd-target:id"]'),
    ).not.toBeNull();
    // The header block holds the qualified name and no anchor at all.
    const header = within(users).getByTitle("public.users").parentElement;
    expect(header?.querySelector('[data-handleid^="erd-"]')).toBeNull();
  });

  // A card that draws no row for the FK column still has to keep its edge:
  // React Flow drops any edge whose handle id it cannot find in the node. ADR
  // 0054 (2) retired the six-column cap, so the far zoom step — which draws the
  // table box alone — is what now leaves an anchor column off the card.
  it("keeps the FK edge when the card does not draw the anchor column", async () => {
    detail.level = "compact";
    render(
      <SchemaErdCanvas graph={extractSchemaGraph(anchorFallbackSnapshot())} />,
    );

    const wide = await findTableCard(/public\.wide table/i);
    expect(within(wide).queryByText("owner_id")).not.toBeInTheDocument();
    expect(
      wide.querySelector('[data-handleid="erd-source:owner_id"]'),
    ).not.toBeNull();
    expect(
      screen.getByLabelText(
        "public.wide.owner_id references public.owners.id (1:N)",
      ),
    ).toBeInTheDocument();
  });

  // The DOM check above proves the handle exists on the row; this proves the
  // edge is the thing using it. jsdom measures every handle at 0x0, so the
  // bezier control points are all that still separates a column anchor (leaves
  // sideways, Left/Right) from the card fallback (leaves upward, Top/Bottom).
  it("draws the FK edge out of the column anchor, not the card handle", async () => {
    render(<SchemaErdCanvas graph={extractSchemaGraph(ordersSnapshot())} />);

    await findTableCard(/public\.orders table/i);
    const edge = screen.getByLabelText(
      "public.orders.user_id references public.users.id (1:N)",
    );
    const drawn = edge
      .querySelector("path.react-flow__edge-path")
      ?.getAttribute("d");
    const control =
      /^M\s*(-?[\d.]+),(-?[\d.]+)\s*C\s*(-?[\d.]+),(-?[\d.]+)/.exec(
        drawn ?? "",
      );

    // A Left/Right anchor puts the first control point level with the start
    // (`[x1 + offset, y1]`); the Top/Bottom card handle pushes it off in y.
    // elkjs stacks these two cards in one column, so x is equal either way and
    // only y tells the two apart.
    expect(control).not.toBeNull();
    const [, , startY, , controlY] = control ?? [];
    expect(controlY).toBe(startY);
  });

  it("marks each edge with the cardinality it read off the schema", async () => {
    render(<SchemaErdCanvas graph={extractSchemaGraph(oneToOneSnapshot())} />);

    await findTableCard(/public\.profiles table/i);
    expect(
      screen.getByLabelText(
        "public.profiles.user_id references public.users.id (1:1)",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1:1", { selector: "[data-cardinality]" }),
    ).toBeInTheDocument();
  });

  it("shows the qualified name and the schema badge on each node", async () => {
    render(
      <SchemaErdCanvas graph={extractSchemaGraph(multiSchemaSnapshot())} />,
    );

    const orders = await findTableCard(/sales\.orders table/i);
    expect(within(orders).getByText("sales.orders")).toBeInTheDocument();
    expect(within(orders).getByText("sales")).toBeInTheDocument();

    const users = screen.getByRole("button", { name: /public\.users table/i });
    expect(within(users).getByText("public.users")).toBeInTheDocument();
    // Two schemas on one flat canvas, each with its own badge tone class.
    expect(badgeToneClass(users)).not.toBe(badgeToneClass(orders));
  });

  it("keeps table columns legible and exposes selection state", async () => {
    const handleSelect = vi.fn();
    render(
      <SchemaErdCanvas
        graph={extractSchemaGraph(ordersSnapshot())}
        selectedTableId="table:public.users"
        onSelectedTableIdChange={handleSelect}
      />,
    );

    const users = await findTableCard(/public\.users table/i);
    expect(users).toHaveAttribute("aria-pressed", "true");
    expect(within(users).getByText("id")).toBeInTheDocument();
    expect(within(users).getByText("email")).toBeInTheDocument();
    expect(
      screen.getByText(/metadata readiness unknown for this graph/i),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /public\.orders table/i }),
    );
    expect(handleSelect).toHaveBeenCalledWith("table:public.orders");
  });

  // Reason: 이슈 #1736 — 선택된 노드 재클릭 시 toggle 해제 (2026-07-24)
  it("toggles selection off when the already-selected node is re-clicked", async () => {
    const handleSelect = vi.fn();
    render(
      <SchemaErdCanvas
        graph={extractSchemaGraph(ordersSnapshot())}
        onSelectedTableIdChange={handleSelect}
      />,
    );

    const users = await findTableCard(/public\.users table/i);
    fireEvent.click(users);
    expect(users).toHaveAttribute("aria-pressed", "true");
    expect(handleSelect).toHaveBeenLastCalledWith("table:public.users");

    fireEvent.click(users);
    expect(users).toHaveAttribute("aria-pressed", "false");
    expect(handleSelect).toHaveBeenLastCalledWith(null);
  });

  // Reason: 이슈 #1736 — 빈 캔버스 클릭 시 선택 해제 (2026-07-24)
  it("clears selection when the empty canvas pane is clicked", async () => {
    const handleSelect = vi.fn();
    const { container } = render(
      <SchemaErdCanvas
        graph={extractSchemaGraph(ordersSnapshot())}
        onSelectedTableIdChange={handleSelect}
      />,
    );

    const users = await findTableCard(/public\.users table/i);
    fireEvent.click(users);
    expect(users).toHaveAttribute("aria-pressed", "true");

    const pane = container.querySelector(".react-flow__pane");
    expect(pane).not.toBeNull();
    fireEvent.click(pane as Element);
    expect(users).toHaveAttribute("aria-pressed", "false");
    expect(handleSelect).toHaveBeenLastCalledWith(null);
  });

  // Reason: 이슈 #1736 — ESC 키로 선택 해제 (2026-07-24)
  it("clears selection when Escape is pressed", async () => {
    const handleSelect = vi.fn();
    render(
      <SchemaErdCanvas
        graph={extractSchemaGraph(ordersSnapshot())}
        onSelectedTableIdChange={handleSelect}
      />,
    );

    const users = await findTableCard(/public\.users table/i);
    fireEvent.click(users);
    expect(users).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(users).toHaveAttribute("aria-pressed", "false");
    expect(handleSelect).toHaveBeenLastCalledWith(null);
  });

  it("highlights only relationships connected to the focused table", async () => {
    render(
      <SchemaErdCanvas
        graph={extractSchemaGraph(ordersSnapshot())}
        selectedTableId="table:public.users"
      />,
    );

    await findTableCard(/public\.users table/i);
    expect(
      screen.getByLabelText(
        "public.orders.user_id references public.users.id (1:N)",
      ),
    ).toHaveAttribute("data-highlighted", "true");
    expect(
      screen.getByLabelText(
        "public.payments.order_id references public.orders.id (1:N)",
      ),
    ).toHaveAttribute("data-highlighted", "false");
    expect(
      screen.getByRole("button", { name: /public\.orders table/i }),
    ).toHaveAttribute("data-related", "true");
    expect(
      screen.getByRole("button", { name: /public\.payments table/i }),
    ).toHaveAttribute("data-related", "false");
  });

  it("treats a stale selected table id as no active selection", async () => {
    render(
      <SchemaErdCanvas
        graph={extractSchemaGraph(ordersSnapshot())}
        selectedTableId="table:public.missing"
      />,
    );

    await findTableCard(/public\.users table/i);
    expect(
      screen.getByRole("button", { name: /fit selected table/i }),
    ).toBeDisabled();

    for (const label of [
      /public\.users table/i,
      /public\.orders table/i,
      /public\.payments table/i,
    ]) {
      const tableButton = screen.getByRole("button", { name: label });
      expect(tableButton).toHaveAttribute("aria-pressed", "false");
      expect(tableButton).not.toHaveAttribute("aria-current");
      expect(tableButton).toHaveAttribute("data-related", "true");
    }

    expect(
      screen.getByLabelText(
        "public.orders.user_id references public.users.id (1:N)",
      ),
    ).toHaveAttribute("data-highlighted", "true");
  });

  it("filters search results and focuses a matching table", async () => {
    const handleSelect = vi.fn();
    render(
      <SchemaErdCanvas
        graph={extractSchemaGraph(ordersSnapshot())}
        onSelectedTableIdChange={handleSelect}
      />,
    );

    await findTableCard(/public\.users table/i);
    fireEvent.change(screen.getByRole("textbox", { name: /search erd/i }), {
      target: { value: "pay" },
    });

    const results = screen.getByRole("listbox", {
      name: /erd table search results/i,
    });
    expect(
      within(results).getByRole("option", { name: "public.payments" }),
    ).toBeInTheDocument();
    expect(
      within(results).queryByRole("option", { name: "public.users" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(results).getByRole("option", { name: "public.payments" }),
    );

    expect(handleSelect).toHaveBeenCalledWith("table:public.payments");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /public\.payments table/i }),
      ).toHaveFocus(),
    );
  });

  it("exposes no-match search feedback inside the search result list", async () => {
    render(<SchemaErdCanvas graph={extractSchemaGraph(ordersSnapshot())} />);

    await findTableCard(/public\.users table/i);
    fireEvent.change(screen.getByRole("textbox", { name: /search erd/i }), {
      target: { value: "missing" },
    });

    const results = screen.getByRole("listbox", {
      name: /erd table search results/i,
    });
    expect(
      within(results).getByRole("option", { name: /no matching tables/i }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("shows incoming and outgoing dependencies with selected-table metadata", async () => {
    const intelligence = selectSchemaGraphIntelligence(
      ordersSnapshotWithMetadata(),
    );

    render(
      <SchemaErdCanvas
        graph={intelligence.graph}
        intelligence={intelligence}
        selectedTableId="table:public.users"
      />,
    );

    const dependencies = await screen.findByRole("region", {
      name: /dependencies for public\.users/i,
    });
    expect(within(dependencies).getByText("Incoming")).toBeInTheDocument();
    expect(within(dependencies).getByText("Outgoing")).toBeInTheDocument();
    expect(
      within(dependencies).getByText("orders_user_id_fkey"),
    ).toBeInTheDocument();
    expect(
      within(dependencies).getByText(
        "public.orders (user_id) -> public.users (id)",
      ),
    ).toBeInTheDocument();
    expect(
      within(dependencies).getByText("users_email_idx"),
    ).toBeInTheDocument();
    expect(
      within(dependencies).queryByText(/metadata incomplete/i),
    ).not.toBeInTheDocument();
  });

  it("shows metadata gaps and SchemaGraph diagnostics for selected tables", async () => {
    const intelligence = selectSchemaGraphIntelligence(
      missingReferenceSnapshot(),
    );

    render(
      <SchemaErdCanvas
        graph={intelligence.graph}
        intelligence={intelligence}
        selectedTableId="table:public.orders"
      />,
    );

    const dependencies = await screen.findByRole("region", {
      name: /dependencies for public\.orders/i,
    });
    expect(dependencies).toHaveTextContent(
      /dependency metadata incomplete: missing constraints/i,
    );
    expect(
      within(dependencies).getByText("missing-reference-table"),
    ).toBeInTheDocument();
    expect(within(dependencies).queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows useful empty and isolated-table states", async () => {
    const { rerender } = render(
      <SchemaErdCanvas graph={extractSchemaGraph(emptySnapshot())} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /no tables to diagram/i,
    );

    rerender(
      <SchemaErdCanvas graph={extractSchemaGraph(isolatedSnapshot())} />,
    );
    expect(await findTableCard(/main\.events table/i)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /no relationships yet/i,
    );
  });

  // ADR 0054 (2) retires the six-column cap: at the zoom jsdom reports (1) the
  // canvas resolves the `full` level and a nine-column table draws all nine.
  it("draws every column at close zoom instead of capping at six", async () => {
    render(<SchemaErdCanvas graph={extractSchemaGraph(wideTableSnapshot())} />);

    const wide = await findTableCard(/main\.wide table/i);
    for (let index = 1; index <= 9; index += 1) {
      expect(within(wide).getByText(`c${index}`)).toBeInTheDocument();
    }
    expect(within(wide).queryByText(/columns hidden/i)).not.toBeInTheDocument();
    // The level comes from the live viewport zoom, not from a constant.
    expect(erdDetailLevel).toHaveBeenCalledWith(1);
  });

  it("keeps only the PK/FK columns at mid zoom and marks the rest hidden", async () => {
    detail.level = "keys";
    render(
      <SchemaErdCanvas graph={extractSchemaGraph(keyedTableSnapshot())} />,
    );

    const orders = await findTableCard(/public\.orders table/i);
    expect(within(orders).getByText("id")).toBeInTheDocument();
    expect(within(orders).getByText("order_id")).toBeInTheDocument();
    expect(within(orders).queryByText("note")).not.toBeInTheDocument();
    expect(within(orders).queryByText("amount")).not.toBeInTheDocument();
    expect(within(orders).getByText(/2 columns hidden/i)).toBeInTheDocument();
  });

  // A canvas that resolved the level once, or from a constant, would still pass
  // the two tests above — this is what makes the level follow the viewport.
  it("resolves the detail level from the live viewport zoom", async () => {
    vi.mocked(erdDetailLevel).mockClear();
    render(<SchemaErdCanvas graph={extractSchemaGraph(ordersSnapshot())} />);
    await findTableCard(/public\.users table/i);

    await waitFor(
      () => {
        const zooms = vi
          .mocked(erdDetailLevel)
          .mock.calls.map(([zoom]) => zoom);
        // React Flow mounts at 1, then the auto-fit moves the viewport.
        expect(zooms).toContain(1);
        expect(zooms.some((zoom) => zoom !== 1)).toBe(true);
      },
      { timeout: ERD_LAYOUT_TIMEOUT_MS },
    );
  });

  it("shows the table box alone at far zoom", async () => {
    detail.level = "compact";
    render(
      <SchemaErdCanvas graph={extractSchemaGraph(keyedTableSnapshot())} />,
    );

    const orders = await findTableCard(/public\.orders table/i);
    expect(within(orders).getByText("public.orders")).toBeInTheDocument();
    for (const name of ["id", "order_id", "note", "amount"]) {
      expect(within(orders).queryByText(name)).not.toBeInTheDocument();
    }
    expect(within(orders).getByText(/4 columns hidden/i)).toBeInTheDocument();
  });

  // The two tests above read the columns a card spells out; this one reads the
  // box. Both halves have to move together: the card is what shrinks, and React
  // Flow places the FK handles off the node element, so a card that shrank
  // while the node kept the taller height would leave every edge pointing at
  // where the card used to end.
  it("shrinks the card and its React Flow node together when the zoom step changes", async () => {
    const graph = extractSchemaGraph(keyedTableSnapshot());
    const { rerender } = render(<SchemaErdCanvas graph={graph} />);

    const orders = await findTableCard(/public\.orders table/i);
    const wrapper = orders.closest(".react-flow__node");
    expect(wrapper).not.toBeNull();
    // erdTableHeight(4 visible, 0 hidden) — also the slot elkjs reserved.
    expect(orders).toHaveStyle({ height: "166px" });
    expect(wrapper).toHaveStyle({ height: "166px" });

    detail.level = "compact";
    rerender(<SchemaErdCanvas graph={graph} />);

    // erdTableHeight(0 visible, 4 hidden) — the header plus the hidden-count row.
    await waitFor(() => expect(orders).toHaveStyle({ height: "88px" }));
    expect(wrapper).toHaveStyle({ height: "88px" });
  });

  it("re-runs the elkjs layout only when the layout input changes", async () => {
    vi.mocked(layoutErdModel).mockClear();
    const { rerender } = render(
      <SchemaErdCanvas graph={extractSchemaGraph(ordersSnapshot())} />,
    );
    await findTableCard(/public\.users table/i);
    expect(layoutErdModel).toHaveBeenCalledTimes(1);

    // Indexes/constraints landing later hand the canvas a brand new
    // SchemaGraph object with the same tables and FKs — dragged positions have
    // to survive that, so no new layout may run.
    rerender(
      <SchemaErdCanvas
        graph={extractSchemaGraph(ordersSnapshotWithMetadata())}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /public\.users table/i }),
      ).toBeInTheDocument(),
    );
    expect(layoutErdModel).toHaveBeenCalledTimes(1);

    rerender(
      <SchemaErdCanvas graph={extractSchemaGraph(extraTableSnapshot())} />,
    );
    await findTableCard(/public\.refunds table/i);
    expect(layoutErdModel).toHaveBeenCalledTimes(2);
  });

  // The panel prefetches columns per schema after first paint. A schema with
  // no FKs gains no edges when they land, so a fingerprint that ignored card
  // height left the first-paint layout in place and every card overlapped
  // the one below it.
  it("re-lays out when late columns grow the cards of an FK-less schema", async () => {
    vi.mocked(layoutErdModel).mockClear();
    const { rerender } = render(
      <SchemaErdCanvas
        graph={extractSchemaGraph(fkFreeSnapshot({ withColumns: false }))}
      />,
    );
    await findTableCard(/main\.alpha table/i);
    expect(layoutErdModel).toHaveBeenCalledTimes(1);

    rerender(
      <SchemaErdCanvas
        graph={extractSchemaGraph(fkFreeSnapshot({ withColumns: true }))}
      />,
    );
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("button", { name: /main\.alpha table/i }),
        ).getByText("label"),
      ).toBeInTheDocument(),
    );
    await waitFor(() => expect(layoutErdModel).toHaveBeenCalledTimes(2));
  });

  // Regression cover carried over from the deleted renderer's suite.
  it("shows the selected-table dependency empty state without row links", async () => {
    const intelligence = selectSchemaGraphIntelligence(
      dependencyEmptySnapshotWithMetadata(),
    );

    render(
      <SchemaErdCanvas
        graph={intelligence.graph}
        intelligence={intelligence}
        selectedTableId="table:main.event_log"
      />,
    );

    const dependencies = await screen.findByRole("region", {
      name: /dependencies for main\.event_log/i,
    });
    expect(dependencies).toHaveTextContent(/no dependencies/i);
    expect(within(dependencies).queryByRole("link")).not.toBeInTheDocument();
  });
});

function fkFreeSnapshot({
  withColumns,
}: {
  withColumns: boolean;
}): SchemaGraphCatalogSnapshot {
  const names = ["alpha", "beta", "gamma"];
  return {
    source: { dbType: "duckdb", database: "warehouse.duckdb" },
    schemas: [{ name: "main" }],
    tablesBySchema: { main: names.map((name) => table("main", name)) },
    columnsByTable: {
      main: Object.fromEntries(
        names.map((name) => [
          name,
          withColumns
            ? [
                column("id", { is_primary_key: true }),
                column("label", { data_type: "text" }),
                column("amount", { data_type: "numeric" }),
              ]
            : [],
        ]),
      ),
    },
    constraintsByTable: {},
    indexesByTable: {},
  };
}

function dependencyEmptySnapshotWithMetadata(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "duckdb", database: "events.duckdb" },
    schemas: [{ name: "main" }],
    tablesBySchema: { main: [table("main", "event_log")] },
    columnsByTable: {
      main: { event_log: [column("payload", { data_type: "json" })] },
    },
    indexesByTable: { main: { event_log: [] } },
    constraintsByTable: { main: { event_log: [] } },
  };
}

function badgeToneClass(tableButton: HTMLElement): string {
  const badge = tableButton.querySelector('[class*="text-erd-schema-"]');
  const tone = badge?.getAttribute("class")?.match(/text-erd-schema-\d/)?.[0];
  if (!tone) throw new Error("schema badge tone class missing");
  return tone;
}

function ordersSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [
        table("public", "users"),
        table("public", "orders"),
        table("public", "payments"),
      ],
    },
    columnsByTable: {
      public: {
        users: [
          column("id", { is_primary_key: true }),
          column("email", { data_type: "text" }),
        ],
        orders: [
          column("id", { is_primary_key: true }),
          column("user_id", {
            is_foreign_key: true,
            fk_reference: "public.users(id)",
          }),
          column("total", { data_type: "numeric" }),
        ],
        payments: [
          column("id", { is_primary_key: true }),
          column("order_id", {
            is_foreign_key: true,
            fk_reference: "public.orders(id)",
          }),
          column("status", { data_type: "text" }),
        ],
      },
    },
    constraintsByTable: {},
    indexesByTable: {},
  };
}

function ordersSnapshotWithMetadata(): SchemaGraphCatalogSnapshot {
  const base = ordersSnapshot();
  return {
    ...base,
    constraintsByTable: {
      public: {
        users: [constraint("users_email_key", "UNIQUE", ["email"])],
        orders: [
          constraint("orders_user_id_fkey", "FOREIGN KEY", ["user_id"], {
            reference_table: "public.users",
            reference_columns: ["id"],
          }),
        ],
        payments: [
          constraint("payments_order_id_fkey", "FOREIGN KEY", ["order_id"], {
            reference_table: "public.orders",
            reference_columns: ["id"],
          }),
        ],
      },
    },
    indexesByTable: {
      public: {
        users: [
          {
            name: "users_email_idx",
            columns: ["email"],
            index_type: "btree",
            is_unique: true,
            is_primary: false,
          },
        ],
        orders: [],
        payments: [],
      },
    },
  };
}

function extraTableSnapshot(): SchemaGraphCatalogSnapshot {
  const base = ordersSnapshot();
  return {
    ...base,
    tablesBySchema: {
      public: [...base.tablesBySchema.public!, table("public", "refunds")],
    },
    columnsByTable: {
      public: {
        ...base.columnsByTable.public,
        refunds: [column("id", { is_primary_key: true })],
      },
    },
  };
}

function multiSchemaSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }, { name: "sales" }],
    tablesBySchema: {
      public: [table("public", "users")],
      sales: [table("sales", "orders")],
    },
    columnsByTable: {
      public: { users: [column("id", { is_primary_key: true })] },
      sales: {
        orders: [
          column("id", { is_primary_key: true }),
          column("user_id", {
            is_foreign_key: true,
            fk_reference: "public.users(id)",
          }),
        ],
      },
    },
    constraintsByTable: {},
    indexesByTable: {},
  };
}

function emptySnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "sqlite", database: "empty.sqlite" },
    schemas: [],
    tablesBySchema: {},
    columnsByTable: {},
    constraintsByTable: {},
    indexesByTable: {},
  };
}

function isolatedSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "duckdb", database: "events.duckdb" },
    schemas: [{ name: "main" }],
    tablesBySchema: { main: [table("main", "events")] },
    columnsByTable: {
      main: {
        events: [
          column("id", { is_primary_key: true }),
          column("payload", { data_type: "json" }),
        ],
      },
    },
    constraintsByTable: {},
    indexesByTable: {},
  };
}

/** Two key columns and two plain ones, so each detail level renders differently. */
function keyedTableSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: { public: [table("public", "orders")] },
    columnsByTable: {
      public: {
        orders: [
          column("id", { is_primary_key: true }),
          column("order_id", {
            is_foreign_key: true,
            fk_reference: "public.orders(id)",
          }),
          column("note", { data_type: "text" }),
          column("amount", { data_type: "numeric" }),
        ],
      },
    },
    constraintsByTable: {},
    indexesByTable: {},
  };
}

function wideTableSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "duckdb", database: "wide.duckdb" },
    schemas: [{ name: "main" }],
    tablesBySchema: { main: [table("main", "wide")] },
    columnsByTable: {
      main: {
        wide: Array.from({ length: 9 }, (_unused, index) =>
          column(`c${index + 1}`),
        ),
      },
    },
    constraintsByTable: {},
    indexesByTable: {},
  };
}

/** A wide table whose FK column is the anchor a shrunken card has to keep. */
function anchorFallbackSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [table("public", "owners"), table("public", "wide")],
    },
    columnsByTable: {
      public: {
        owners: [column("id", { is_primary_key: true })],
        wide: [
          ...Array.from({ length: 6 }, (_unused, index) =>
            column(`c${index + 1}`),
          ),
          column("owner_id", {
            is_foreign_key: true,
            fk_reference: "public.owners(id)",
          }),
        ],
      },
    },
    constraintsByTable: {},
    indexesByTable: {},
  };
}

/** A unique index over the FK column makes the relationship 1:1. */
function oneToOneSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [table("public", "users"), table("public", "profiles")],
    },
    columnsByTable: {
      public: {
        users: [column("id", { is_primary_key: true })],
        profiles: [
          column("id", { is_primary_key: true }),
          column("user_id", {
            is_foreign_key: true,
            fk_reference: "public.users(id)",
          }),
        ],
      },
    },
    constraintsByTable: {},
    indexesByTable: {
      public: {
        profiles: [
          {
            name: "profiles_user_id_key",
            columns: ["user_id"],
            index_type: "btree",
            is_unique: true,
            is_primary: false,
          },
        ],
      },
    },
  };
}

function missingReferenceSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: { public: [table("public", "orders")] },
    columnsByTable: {
      public: {
        orders: [
          column("id", { is_primary_key: true }),
          column("account_id", {
            is_foreign_key: true,
            fk_reference: "public.accounts(id)",
          }),
        ],
      },
    },
    indexesByTable: { public: { orders: [] } },
  };
}

function table(schema: string, name: string): TableInfo {
  return { schema, name, row_count: null };
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

function constraint(
  name: string,
  constraint_type: string,
  columns: string[],
  overrides: {
    reference_table?: string | null;
    reference_columns?: string[] | null;
  } = {},
) {
  return {
    name,
    constraint_type,
    columns,
    reference_table: null,
    reference_columns: null,
    ...overrides,
  };
}
