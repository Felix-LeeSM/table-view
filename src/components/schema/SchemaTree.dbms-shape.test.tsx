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
    // "level 2" of the 3-level tree). Sprint 144 (AC-145-1) — every PG
    // schema now auto-expands on first paint, so the existing schema is
    // already aria-expanded="true" without a user click.
    expect(screen.getByLabelText("public schema")).toBeInTheDocument();
    expect(screen.getByLabelText("public schema")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  // ─────────────────────────────────────────────────────────────────────
  // Sprint 144 (AC-145-1) — PG: every schema auto-expands on first paint
  // ─────────────────────────────────────────────────────────────────────
  it("PG auto-expands every schema returned by the catalog on first paint (AC-145-1)", async () => {
    // The 2026-04-27 user feedback complained that connecting to a PG
    // database with multiple custom schemas required clicking every
    // chevron individually before any tables appeared. The unified-view
    // contract (Q4=B) wants every schema visible at once.
    useConnectionStore.setState({
      connections: [makeConnection("pg-multi", "postgresql")],
    });
    setSchemaStoreState({
      schemas: {
        "pg-multi": [
          { name: "public" },
          { name: "analytics" },
          { name: "audit" },
        ],
      },
      tables: {
        "pg-multi:public": [
          { name: "users", schema: "public", row_count: null },
        ],
        "pg-multi:analytics": [
          { name: "events", schema: "analytics", row_count: null },
        ],
        "pg-multi:audit": [{ name: "trail", schema: "audit", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="pg-multi" />);
    });

    for (const name of ["public", "analytics", "audit"]) {
      expect(screen.getByLabelText(`${name} schema`)).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    }
    // Every table row is reachable without a single click.
    expect(screen.getByLabelText("users table")).toBeInTheDocument();
    expect(screen.getByLabelText("events table")).toBeInTheDocument();
    expect(screen.getByLabelText("trail table")).toBeInTheDocument();
  });

  it("PG schema auto-expand remains togglable via click (collapse → expand) (AC-145-1)", async () => {
    // Auto-expansion is the *initial* state, not a forced one — the user
    // still needs to be able to collapse a schema row to focus on
    // another. This pins the toggle behavior alongside the auto-expand
    // contract so a future regression that hard-pins all schemas open
    // surfaces here.
    useConnectionStore.setState({
      connections: [makeConnection("pg-toggle", "postgresql")],
    });
    setSchemaStoreState({
      schemas: { "pg-toggle": [{ name: "public" }] },
      tables: {
        "pg-toggle:public": [
          { name: "users", schema: "public", row_count: null },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="pg-toggle" />);
    });

    const schemaBtn = screen.getByLabelText("public schema");
    expect(schemaBtn).toHaveAttribute("aria-expanded", "true");

    await act(async () => {
      schemaBtn.click();
    });
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

  // ─────────────────────────────────────────────────────────────────────
  // Sprint 144 (AC-145-3) — Functions category does not push the sidebar
  // wider when expanded.
  //
  // jsdom doesn't run real layout, so a literal getBoundingClientRect()
  // delta-check would assert nothing meaningful. Instead, this test pins
  // the structural invariants that prevent horizontal overflow:
  //
  //   1. The Functions category content wrapper is `data-category-overflow=
  //      "capped"` so the items list scrolls *vertically* — never pushes
  //      out horizontally.
  //   2. Every function row button carries `w-full` (button width = parent
  //      width, not content-driven).
  //   3. The function-arguments cell (the only span with potentially
  //      unbounded text) carries `truncate` so a long signature gets
  //      ellipsized rather than overflowing.
  //
  // Together these three invariants guarantee the ≤1px width delta the
  // spec requires; the e2e suite can layer a real-browser width check
  // on top in a later sprint.
  // ─────────────────────────────────────────────────────────────────────
  it("expanding the Functions category keeps the row layout overflow-safe (AC-145-3)", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("pg-fn", "postgresql")],
    });
    setSchemaStoreState({
      schemas: { "pg-fn": [{ name: "public" }] },
      tables: {
        "pg-fn:public": [{ name: "users", schema: "public", row_count: null }],
      },
      functions: {
        "pg-fn:public": [
          {
            name: "compute_quarterly_revenue_with_currency_normalization",
            schema: "public",
            arguments:
              "(start_date date, end_date date, target_currency text DEFAULT 'USD'::text)",
            return_type: "numeric",
            kind: "function",
          },
          {
            name: "log_user_event",
            schema: "public",
            arguments: "(user_id uuid, event_name text, payload jsonb)",
            return_type: "void",
            kind: "function",
          },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="pg-fn" />);
    });

    // Schema is auto-expanded (sprint 144 contract); click Functions to
    // expand the category and surface the function rows.
    const fnCategoryBtn = screen.getByLabelText("Functions in public");
    await act(async () => {
      fnCategoryBtn.click();
    });

    // (1) The Functions category wrapper carries the "capped" attribute
    //     which maps to `max-h-[50vh] + overflow-y-auto` (no horizontal
    //     scroll). This keeps long lists vertical-only.
    const cappedWrappers = document.querySelectorAll(
      '[data-category-overflow="capped"]',
    );
    expect(cappedWrappers.length).toBeGreaterThan(0);

    // (2) Every function row button uses `w-full`.
    const longFnBtn = screen.getByLabelText(
      "compute_quarterly_revenue_with_currency_normalization function",
    );
    expect(longFnBtn.className).toContain("w-full");

    // (3) The arguments span (the only potentially unbounded text) is
    //     truncated.
    const argsSpan = longFnBtn.querySelector("span.truncate");
    expect(argsSpan).not.toBeNull();
    expect(argsSpan?.className).toContain("truncate");
  });
});
