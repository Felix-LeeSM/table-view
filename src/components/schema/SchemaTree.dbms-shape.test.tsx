import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useTabStore } from "@stores/tabStore";
import type { ConnectionConfig, DatabaseType } from "@/types/connection";
import { resolveRdbTreeShape } from "./treeShape";

/**
 * Sprint 135 — AC-S135-02 / 03 / 04 / 07: SchemaTree must render at
 * different depths depending on `connection.db_type`.
 *
 *   - `postgresql` → `database → schema → table` (3-level, schema row
 *     visible).
 *   - `mysql`     → `database → table` (2-level, schema row hidden,
 *     categories still visible).
 *   - `sqlite`    → `table` only (1-level, schema row + categories both
 *     hidden — the file is the database).
 *
 * Mongo is asserted in `DocumentDatabaseTree.dbms-shape.test.tsx` via
 * the existing 2-level rendering — see the regression guard there.
 */

const mockLoadSchemas = vi.fn().mockResolvedValue(undefined);
const mockLoadTables = vi.fn().mockResolvedValue(undefined);
const mockLoadViews = vi.fn().mockResolvedValue(undefined);
const mockLoadFunctions = vi.fn().mockResolvedValue(undefined);
const mockPrefetchSchemaColumns = vi.fn().mockResolvedValue(undefined);

function makeConnection(id: string, dbType: DatabaseType): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    db_type: dbType,
    host: "localhost",
    port: 5432,
    user: "postgres",
    has_password: false,
    database: "test",
    group_id: null,
    color: null,
    environment: null,
    paradigm:
      dbType === "mongodb" ? "document" : dbType === "redis" ? "kv" : "rdb",
  };
}

function setSchemaStoreState(overrides: Record<string, unknown> = {}) {
  useSchemaStore.setState({
    schemas: {},
    tables: {},
    views: {},
    functions: {},
    loading: false,
    error: null,
    ...overrides,
    loadSchemas: mockLoadSchemas,
    loadTables: mockLoadTables,
    loadViews: mockLoadViews,
    loadFunctions: mockLoadFunctions,
    prefetchSchemaColumns: mockPrefetchSchemaColumns,
  });
}

function resetStores() {
  setSchemaStoreState();
  useTabStore.setState({ tabs: [], activeTabId: null });
  useConnectionStore.setState({ connections: [] });
}

describe("SchemaTree — DBMS-shape-aware tree depth (Sprint 135)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC-S135-02 — PG: 3-level (database → schema → table)
  // ─────────────────────────────────────────────────────────────────────
  it("PG renders the schema row (3-level: database → schema → table) — AC-S135-02", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("pg1", "postgresql")],
    });
    setSchemaStoreState({
      schemas: { pg1: [{ name: "public" }] },
      tables: {
        "pg1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="pg1" />);
    });

    // The schema row IS rendered for PG (the schema button is the
    // "level 2" of the 3-level tree).
    expect(screen.getByLabelText("public schema")).toBeInTheDocument();
    expect(screen.getByLabelText("public schema")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC-S135-03 — MySQL: 2-level (database → table), no schema row
  // ─────────────────────────────────────────────────────────────────────
  it("MySQL hides the schema row entirely (2-level: database → table) — AC-S135-03", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("my1", "mysql")],
    });
    setSchemaStoreState({
      schemas: { my1: [{ name: "appdb" }] },
      tables: {
        "my1:appdb": [{ name: "orders", schema: "appdb", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="my1" />);
    });

    // The schema button MUST NOT be rendered for MySQL — the schema
    // layer is conflated with database in MySQL, so showing it would
    // duplicate information already in the toolbar's `<DbSwitcher>`.
    expect(screen.queryByLabelText("appdb schema")).toBeNull();

    // Tables are still rendered (auto-expanded behind the scenes), so
    // the user reaches the table list in 1 fewer click than PG.
    expect(screen.getByLabelText("orders table")).toBeInTheDocument();
  });

  it("MySQL still surfaces category headers (Tables / Views / …) so views/functions remain reachable — AC-S135-03", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("my1", "mysql")],
    });
    setSchemaStoreState({
      schemas: { my1: [{ name: "appdb" }] },
      tables: {
        "my1:appdb": [{ name: "orders", schema: "appdb", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="my1" />);
    });

    // The MySQL shape keeps category headers (only the schema row above
    // them is suppressed). This guards against accidentally collapsing
    // MySQL into the SQLite "flat" shape, which would drop views and
    // functions.
    expect(screen.getByLabelText("Tables in appdb")).toBeInTheDocument();
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC-S135-04 — SQLite: 1-level (table list under root), no schema row,
  // no category header
  // ─────────────────────────────────────────────────────────────────────
  it("SQLite renders tables directly under the root (1-level: table list) — AC-S135-04", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("sl1", "sqlite")],
    });
    setSchemaStoreState({
      schemas: { sl1: [{ name: "main" }] },
      tables: {
        "sl1:main": [
          { name: "todos", schema: "main", row_count: null },
          { name: "settings", schema: "main", row_count: null },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="sl1" />);
    });

    // No schema row.
    expect(screen.queryByLabelText("main schema")).toBeNull();
    // No category headers either — SQLite is flat.
    expect(screen.queryByLabelText(/Tables in main/i)).toBeNull();

    // Tables ARE rendered directly under the root.
    expect(screen.getByLabelText("todos table")).toBeInTheDocument();
    expect(screen.getByLabelText("settings table")).toBeInTheDocument();
  });

  it("SQLite shows an empty placeholder when there are no tables — AC-S135-04 boundary", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("sl-empty", "sqlite")],
    });
    setSchemaStoreState({
      schemas: { "sl-empty": [{ name: "main" }] },
      tables: { "sl-empty:main": [] },
    });

    await act(async () => {
      render(<SchemaTree connectionId="sl-empty" />);
    });

    // No tables → "No tables" sentinel rendered directly under the root.
    expect(screen.getByText(/no tables/i)).toBeInTheDocument();
  });

  // ─────────────────────────────────────────────────────────────────────
  // resolveRdbTreeShape — pure function-level coverage (catches the
  // exhaustive switch arms without rendering anything)
  // ─────────────────────────────────────────────────────────────────────
  it("resolveRdbTreeShape maps every relational db_type to a shape", () => {
    expect(resolveRdbTreeShape("postgresql")).toBe("with-schema");
    expect(resolveRdbTreeShape("mysql")).toBe("no-schema");
    expect(resolveRdbTreeShape("sqlite")).toBe("flat");
  });

  it("resolveRdbTreeShape falls back to with-schema for non-relational db_types so a misrouted Mongo/Redis connection doesn't crash", () => {
    // These paradigms route to DocumentDatabaseTree / UnsupportedShell;
    // resolveRdbTreeShape should still return a safe value rather than
    // throwing if SchemaTree is somehow mounted against them.
    expect(resolveRdbTreeShape("mongodb")).toBe("with-schema");
    expect(resolveRdbTreeShape("redis")).toBe("with-schema");
  });
});
