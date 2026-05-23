import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { extractSchemaGraph } from "@/lib/schemaGraph";
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

    fireEvent.click(screen.getByRole("button", { name: /public\.orders/i }));
    expect(handleSelect).toHaveBeenCalledWith("table:public.orders");
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
});

function ordersSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [table("public", "users"), table("public", "orders")],
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
