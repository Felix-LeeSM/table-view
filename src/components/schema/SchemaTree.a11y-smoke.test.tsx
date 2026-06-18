import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import {
  mockLoadSchemas,
  mockLoadTables,
  resetStores,
  setSchemaStoreState,
} from "./__tests__/schemaTreeTestHelpers";

describe("SchemaTree critical accessibility smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
  });

  it("exposes the schema/category/table cascade as a tree of treeitems", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const tree = screen.getByRole("tree", { name: "conn1 schema tree" });
    const schema = within(tree).getByRole("treeitem", {
      name: "public schema",
    });
    const tables = within(tree).getByRole("treeitem", {
      name: "Tables in public",
    });
    const users = within(tree).getByRole("treeitem", { name: "users table" });

    expect(schema).toHaveAttribute("aria-level", "1");
    expect(schema).toHaveAttribute("aria-expanded", "true");
    expect(tables).toHaveAttribute("aria-level", "2");
    expect(tables).toHaveAttribute("aria-expanded", "true");
    expect(users).toHaveAttribute("aria-level", "3");

    await act(async () => {
      fireEvent.click(schema);
    });

    expect(schema).toHaveAttribute("aria-expanded", "false");
    expect(
      within(tree).queryByRole("treeitem", { name: "users table" }),
    ).toBeNull();
  });
});
