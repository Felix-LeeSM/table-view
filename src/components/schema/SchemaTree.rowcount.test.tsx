import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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

describe("SchemaTree — Sprint 137 row count tooltip / aria-label", () => {
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
    // rendered into the DOM.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("public schema"));
    });

    // The bare number rendered next to `users` carries both an aria-label
    // (screen reader cue) and a title (native hover tooltip) explaining
    // that the number is an estimate sourced from pg_class.reltuples.
    const cell = document.querySelector('[data-row-count="true"]');
    expect(cell).not.toBeNull();
    expect(cell?.getAttribute("aria-label")).toBe(
      "Estimated row count from pg_class.reltuples",
    );
    expect(cell?.getAttribute("title")).toBe(
      "Estimated row count from pg_class.reltuples",
    );
    // Sanity — the visible number is still rendered (formatted with
    // locale-aware separators, matching the pre-S137 layout).
    expect(cell?.textContent).toBe((12345).toLocaleString());
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
    // present from the initial paint, not behind a schema expand. The
    // tables category is in DEFAULT_EXPANDED, so the row should be
    // visible immediately. Click anyway to be defensive against future
    // changes in default expansion state.
    const cell = document.querySelector('[data-row-count="true"]');
    expect(cell).not.toBeNull();
    expect(cell?.getAttribute("aria-label")).toBe(
      "Estimated row count from information_schema.tables",
    );
    expect(cell?.getAttribute("title")).toBe(
      "Estimated row count from information_schema.tables",
    );
  });

  it("AC-S137-03: SQLite row-count cell labels the source as exact COUNT(*)", async () => {
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
    expect(cell?.getAttribute("aria-label")).toBe(
      "Exact row count via COUNT(*)",
    );
    expect(cell?.getAttribute("title")).toBe("Exact row count via COUNT(*)");
  });

  it("AC-S137-03: row count stays hidden when the schema fetch returned no estimate", async () => {
    // `row_count: null` happens when the catalog query failed or the table
    // is brand-new; in that case the cell must not render at all so the
    // missing tooltip can't mislead the user about a number that isn't
    // there. This pins the pre-existing pre-S137 invariant.
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
    await act(async () => {
      fireEvent.click(screen.getByLabelText("public schema"));
    });

    // The table row still renders — only the count cell is suppressed.
    expect(screen.getByLabelText("users table")).toBeInTheDocument();
    expect(document.querySelector('[data-row-count="true"]')).toBeNull();
  });
});
