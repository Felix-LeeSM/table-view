import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useTabStore } from "@stores/tabStore";
import type { ConnectionConfig, DatabaseType } from "@/types/connection";

// ---------------------------------------------------------------------------
// Sprint 137 — AC-S137-03: PG row count cell must carry an aria-label /
// tooltip explaining that the number is an *estimate* sourced from
// `pg_class.reltuples`. The user check on 2026-04-27 found the bare number
// misleading — users assumed it was an exact COUNT(*).
//
// Per the contract we implemented Option (a) (tooltip + aria-label) rather
// than Option (b) (right-click → exact COUNT(*) action), so AC-S137-04
// (confirm dialog gating) is N/A in this sprint and not exercised here.
// ---------------------------------------------------------------------------

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

describe("SchemaTree — Sprint 137 / 143 row count rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
  });

  it("AC-S137-03: PG row-count cell carries the pg_class.reltuples aria-label and title", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("pg1", "postgresql")],
    });
    setSchemaStoreState({
      schemas: { pg1: [{ name: "public" }] },
      tables: {
        "pg1:public": [{ name: "users", schema: "public", row_count: 12345 }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="pg1" />);
    });

    // Expand the schema so the table row (and its row-count cell) is
    // Sprint 143 (AC-148-1) — the cell now prefixes the locale-separated
    // number with `~` so users read it as an estimate at a glance. The
    // long-form aria-label/title still names the estimate source.
    const cell = document.querySelector('[data-row-count="true"]');
    expect(cell).not.toBeNull();
    expect(cell?.getAttribute("aria-label")).toBe(
      "Estimated row count from pg_class.reltuples",
    );
    expect(cell?.getAttribute("title")).toBe(
      "Estimated row count from pg_class.reltuples",
    );
    expect(cell?.textContent).toBe(`~${(12345).toLocaleString()}`);
  });

  it("AC-S137-03: MySQL row-count cell labels the source as information_schema", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("my1", "mysql")],
    });
    setSchemaStoreState({
      schemas: { my1: [{ name: "appdb" }] },
      tables: {
        "my1:appdb": [{ name: "orders", schema: "appdb", row_count: 9876 }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="my1" />);
    });

    // MySQL is a 2-level (no schema row) tree — the table category is
    // present from the initial paint, not behind a schema expand.
    const cell = document.querySelector('[data-row-count="true"]');
    expect(cell).not.toBeNull();
    expect(cell?.getAttribute("aria-label")).toBe(
      "Estimated row count from information_schema.tables",
    );
    expect(cell?.getAttribute("title")).toBe(
      "Estimated row count from information_schema.tables",
    );
    // Sprint 143 (AC-148-1) — MySQL is also an estimate source, so the
    // tilde prefix is required just like PG.
    expect(cell?.textContent).toBe(`~${(9876).toLocaleString()}`);
  });

  it("AC-148-2: SQLite row-count cell renders `?` (no estimate metadata)", async () => {
    // Sprint 143 (AC-148-2) — SQLite has no estimate catalog, so the
    // sidebar shows `?` until the lazy exact-count fetch (deferred to a
    // later sprint) replaces it. The cell is always present so the
    // user never sees a blank slot where a number used to be.
    useConnectionStore.setState({
      connections: [makeConnection("lite1", "sqlite")],
    });
    setSchemaStoreState({
      schemas: { lite1: [{ name: "main" }] },
      tables: {
        "lite1:main": [{ name: "logs", schema: "main", row_count: 42 }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="lite1" />);
    });

    const cell = document.querySelector('[data-row-count="true"]');
    expect(cell).not.toBeNull();
    // Visible cue: literal `?` rather than the locale-separated number.
    expect(cell?.textContent).toBe("?");
    // Long-form a11y copy explains the `?` to screen-reader users.
    expect(cell?.getAttribute("aria-label")).toBe(
      "Exact row count not yet fetched",
    );
    expect(cell?.getAttribute("title")).toBe("Exact row count not yet fetched");
  });

  it("AC-148-2: PG row-count cell renders `?` when the schema fetch returned no estimate", async () => {
    // Sprint 143 (AC-148-2) — `row_count: null` happens when the catalog
    // query failed or the table is brand-new (no ANALYZE yet). Pre-S143
    // the cell was suppressed entirely; per spec edge case the user
    // should now see `?` so they know the value is *unknown*, not
    // *zero*. The catch-all `?` rendering is shared with SQLite.
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
    expect(screen.getByLabelText("users table")).toBeInTheDocument();
    const cell = document.querySelector('[data-row-count="true"]');
    expect(cell).not.toBeNull();
    expect(cell?.textContent).toBe("?");
    expect(cell?.getAttribute("aria-label")).toBe(
      "Exact row count not yet fetched",
    );
  });
});
