import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import type { ConnectionConfig, DatabaseType } from "@/types/connection";

// Sprint 263 — flat-key seeds (`{ pg1: [...] }`, `{ "pg1:public": [...] }`)
// are translated into the new `(connId, db)`-nested cache shape under the
// `db1` sentinel. The local `activateConnection` seed mirrors the shared
// `schemaTreeTestHelpers.resetStores` pattern so `useSchemaCache` can
// resolve the workspace db.
const DEFAULT_DB = "db1";
function translateFlatSeeds(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...overrides };
  if ("schemas" in overrides && overrides.schemas) {
    const schemas = overrides.schemas as Record<string, unknown>;
    const sample = Object.values(schemas)[0];
    if (Array.isArray(sample)) {
      const next: Record<string, Record<string, unknown>> = {};
      for (const [cid, list] of Object.entries(schemas)) {
        next[cid] = { [DEFAULT_DB]: list };
      }
      out.schemas = next;
    }
  }
  for (const axis of ["tables", "views", "functions"] as const) {
    if (axis in overrides && overrides[axis]) {
      const raw = overrides[axis] as Record<string, unknown>;
      const keys = Object.keys(raw);
      if (keys.some((k) => k.includes(":"))) {
        const next: Record<
          string,
          Record<string, Record<string, unknown>>
        > = {};
        for (const [composite, list] of Object.entries(raw)) {
          const [cid, schema] = composite.split(":");
          if (!cid || !schema) continue;
          next[cid] ??= {};
          next[cid]![DEFAULT_DB] ??= {};
          next[cid]![DEFAULT_DB]![schema] = list;
        }
        out[axis] = next;
      }
    }
  }
  return out;
}
function activateConnection(connId: string) {
  useConnectionStore.setState((s) => ({
    activeStatuses: {
      ...s.activeStatuses,
      [connId]: { type: "connected", activeDb: DEFAULT_DB },
    },
  }));
}

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
    dbType: dbType,
    host: "localhost",
    port: 5432,
    user: "postgres",
    hasPassword: false,
    database: "test",
    groupId: null,
    color: null,
    environment: null,
    paradigm:
      dbType === "mongodb" ? "document" : dbType === "redis" ? "kv" : "rdb",
  };
}

function setSchemaStoreState(overrides: Record<string, unknown> = {}) {
  const translated = translateFlatSeeds(overrides);
  useSchemaStore.setState({
    schemas: {},
    tables: {},
    views: {},
    functions: {},
    loading: false,
    error: null,
    ...translated,
    loadSchemas: mockLoadSchemas,
    loadTables: mockLoadTables,
    loadViews: mockLoadViews,
    loadFunctions: mockLoadFunctions,
    prefetchSchemaColumns: mockPrefetchSchemaColumns,
  });
}

function resetStores() {
  setSchemaStoreState();
  useWorkspaceStore.setState({ workspaces: {} });
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
    activateConnection("pg1");
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
    activateConnection("my1");
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

  it("#1308: SQLite row-count cell renders the exact COUNT(*) (bare number, no tilde, no `?`)", async () => {
    // #1308 — the backend (`sqlite/connection.rs::list_tables`) sends an
    // exact `row_count: Some(COUNT(*))` for SQLite, matching the module
    // comment. The old code force-returned `?` for every SQLite cell,
    // dropping the real number and diverging from the grid footer. SQLite
    // is exact, so the cell shows the bare locale-separated number with no
    // `~` estimate prefix.
    useConnectionStore.setState({
      connections: [makeConnection("lite1", "sqlite")],
    });
    activateConnection("lite1");
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
    // Exact count shown bare — no `~` (that flags estimates) and no `?`.
    expect(cell?.textContent).toBe((42).toLocaleString());
    // Long-form a11y copy tells screen-reader users the count is exact.
    expect(cell?.getAttribute("aria-label")).toBe("Exact row count");
    expect(cell?.getAttribute("title")).toBe("Exact row count");
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
    activateConnection("pg1");
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
