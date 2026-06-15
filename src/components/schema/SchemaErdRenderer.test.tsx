import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { extractSchemaGraph } from "@/lib/schemaGraph";
import { selectSchemaGraphIntelligence } from "@/lib/schemaGraphSelectors";
import type { SchemaGraphCatalogSnapshot } from "@/types/schemaGraph";
import type { ColumnInfo, TableInfo } from "@/types/schema";
import SchemaErdRenderer from "./SchemaErdRenderer";

describe("SchemaErdRenderer", () => {
  it("renders table nodes and FK relationships from a SchemaGraph", () => {
    render(<SchemaErdRenderer graph={extractSchemaGraph(ordersSnapshot())} />);

    expect(
      screen.getByRole("figure", { name: /database relationship diagram/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /public\.orders table/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /public\.users table/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("public.orders.user_id references public.users.id"),
    ).toBeInTheDocument();
  });

  it("keeps table content legible and exposes selection state", () => {
    const handleSelect = vi.fn();
    render(
      <SchemaErdRenderer
        graph={extractSchemaGraph(ordersSnapshot())}
        selectedTableId="table:public.users"
        onSelectedTableIdChange={handleSelect}
      />,
    );

    const users = screen.getByRole("button", {
      name: /public\.users table/i,
    });
    expect(users).toHaveAttribute("aria-pressed", "true");
    expect(within(users).getByText("id")).toBeInTheDocument();
    expect(within(users).getByText("email")).toBeInTheDocument();
    expect(
      screen.getByText(/metadata readiness unknown for this graph/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /public\.orders/i }));
    expect(handleSelect).toHaveBeenCalledWith("table:public.orders");
  });

  it("shows incoming and outgoing dependencies with selected-table metadata", () => {
    const intelligence = selectSchemaGraphIntelligence(
      ordersSnapshotWithMetadata(),
    );

    render(
      <SchemaErdRenderer
        graph={intelligence.graph}
        intelligence={intelligence}
        selectedTableId="table:public.users"
      />,
    );

    const dependencies = screen.getByRole("region", {
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
      within(dependencies).getByText("users_email_key"),
    ).toBeInTheDocument();
    expect(
      within(dependencies).getByText("CHECK ((age >= 0))"),
    ).toBeInTheDocument();
    expect(
      within(dependencies).queryByText(/metadata incomplete/i),
    ).not.toBeInTheDocument();
  });

  it("shows useful empty and isolated-table states", () => {
    const { rerender } = render(
      <SchemaErdRenderer graph={extractSchemaGraph(emptySnapshot())} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /no tables to diagram/i,
    );

    rerender(
      <SchemaErdRenderer graph={extractSchemaGraph(isolatedSnapshot())} />,
    );
    expect(
      screen.getByRole("button", { name: /main\.events table/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /no relationships yet/i,
    );
  });

  it("shows selected-table dependency empty state without row navigation links", () => {
    const intelligence = selectSchemaGraphIntelligence(
      dependencyEmptySnapshotWithMetadata(),
    );

    render(
      <SchemaErdRenderer
        graph={intelligence.graph}
        intelligence={intelligence}
        selectedTableId="table:main.event_log"
      />,
    );

    const dependencies = screen.getByRole("region", {
      name: /dependencies for main\.event_log/i,
    });
    expect(dependencies).toHaveTextContent(/no dependencies/i);
    expect(within(dependencies).queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows metadata gaps and SchemaGraph diagnostics for selected tables", () => {
    const intelligence = selectSchemaGraphIntelligence(
      missingReferenceSnapshot(),
    );

    render(
      <SchemaErdRenderer
        graph={intelligence.graph}
        intelligence={intelligence}
        selectedTableId="table:public.orders"
      />,
    );

    const dependencies = screen.getByRole("region", {
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

  it("filters search results and focuses a matching table", async () => {
    const handleSelect = vi.fn();
    render(
      <SchemaErdRenderer
        graph={extractSchemaGraph(ordersSnapshot())}
        onSelectedTableIdChange={handleSelect}
      />,
    );

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

  it("exposes no-match search feedback inside the search result list", () => {
    render(<SchemaErdRenderer graph={extractSchemaGraph(ordersSnapshot())} />);

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

  it("highlights only relationships connected to the focused table", () => {
    render(
      <SchemaErdRenderer
        graph={extractSchemaGraph(ordersSnapshot())}
        selectedTableId="table:public.users"
      />,
    );

    expect(
      screen.getByLabelText("public.orders.user_id references public.users.id"),
    ).toHaveAttribute("data-highlighted", "true");
    expect(
      screen.getByLabelText(
        "public.payments.order_id references public.orders.id",
      ),
    ).toHaveAttribute("data-highlighted", "false");
    expect(
      screen.getByRole("button", { name: /public\.orders table/i }),
    ).toHaveAttribute("data-related", "true");
    expect(
      screen.getByRole("button", { name: /public\.payments table/i }),
    ).toHaveAttribute("data-related", "false");
  });

  it("treats a stale selected table id as no active selection", () => {
    render(
      <SchemaErdRenderer
        graph={extractSchemaGraph(ordersSnapshot())}
        selectedTableId="table:public.missing"
      />,
    );

    expect(
      screen.getByRole("button", { name: /fit selected table/i }),
    ).toBeDisabled();
    expect(screen.queryByText(/focused table:/i)).not.toBeInTheDocument();

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
      screen.getByLabelText("public.orders.user_id references public.users.id"),
    ).toHaveAttribute("data-highlighted", "true");
    expect(
      screen.getByLabelText(
        "public.payments.order_id references public.orders.id",
      ),
    ).toHaveAttribute("data-highlighted", "true");
  });

  it("keeps zoom and focus controls local to the ERD surface", () => {
    render(<SchemaErdRenderer graph={extractSchemaGraph(ordersSnapshot())} />);

    fireEvent.click(screen.getByRole("button", { name: /public\.orders/i }));
    fireEvent.click(screen.getByRole("button", { name: /zoom in erd/i }));
    expect(screen.getByLabelText("ERD zoom percent")).toHaveTextContent("110%");

    fireEvent.click(
      screen.getByRole("button", { name: /fit selected table/i }),
    );
    expect(screen.getByLabelText("ERD zoom percent")).toHaveTextContent("100%");
    expect(
      screen.getByRole("button", { name: /public\.orders table/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("scrolls an externally selected table into view", async () => {
    const scrollIntoView = vi.fn();
    const proto = HTMLElement.prototype;
    const original = proto.scrollIntoView;
    Object.defineProperty(proto, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      render(
        <SchemaErdRenderer
          graph={extractSchemaGraph(ordersSnapshot())}
          selectedTableId="table:public.users"
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: /fit selected table/i }),
      );

      await waitFor(() =>
        expect(scrollIntoView).toHaveBeenCalledWith({
          block: "center",
          inline: "center",
        }),
      );
    } finally {
      if (original) {
        Object.defineProperty(proto, "scrollIntoView", {
          configurable: true,
          value: original,
        });
      } else {
        Reflect.deleteProperty(proto, "scrollIntoView");
      }
    }
  });
});

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
  return {
    ...ordersSnapshot(),
    columnsByTable: {
      public: {
        users: [
          column("id", { is_primary_key: true }),
          column("email", { data_type: "text" }),
          column("age", {
            data_type: "integer",
            check_clauses: ["CHECK ((age >= 0))"],
          }),
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

function dependencyEmptySnapshotWithMetadata(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "duckdb", database: "events.duckdb" },
    schemas: [{ name: "main" }],
    tablesBySchema: { main: [table("main", "event_log")] },
    columnsByTable: {
      main: {
        event_log: [column("payload", { data_type: "json" })],
      },
    },
    indexesByTable: { main: { event_log: [] } },
    constraintsByTable: { main: { event_log: [] } },
  };
}

function missingReferenceSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [table("public", "orders")],
    },
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
