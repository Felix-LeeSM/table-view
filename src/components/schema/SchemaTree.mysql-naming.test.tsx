import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import type { ConnectionConfig, DatabaseType } from "@/types/connection";

/**
 * Sprint 380 — MySQL/SQLite sidebar 의 "Schemas" 헤더 + 잉여 한 단계
 * 들여쓰기 정정.
 *
 * 2026-05-17 작성. MySQL 은 schema = database 동일 개념이라 "Schemas"
 * 헤더가 정보 잉여이고, Tables/Views/Functions/Procedures 가 *비어있는
 * schema 단계* 로 인해 root 보다 한 단계 잉여 들여쓰기. SQLite 도 같은
 * 이유로 헤더가 어색 (단, SQLite 는 flat shape 이라 categories 자체가
 * 없음).
 *
 * 결과 ([AC-380-08]):
 *   - PG     (`with-schema`) → 헤더 "Schemas" + category `pl-6` + item `pl-10`.
 *   - MySQL  (`no-schema`)   → 헤더 없음 + category `pl-3` + item `pl-7`.
 *   - SQLite (`flat`)        → 헤더 없음 + item `pl-3` (category 없음).
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

function seedActiveStatusesFor(connIds: Iterable<string>) {
  useConnectionStore.setState((s) => {
    const next = { ...s.activeStatuses };
    for (const id of connIds) {
      next[id] ??= { type: "connected", activeDb: DEFAULT_DB };
    }
    return { activeStatuses: next };
  });
}

function setSchemaStoreState(overrides: Record<string, unknown> = {}) {
  const translated = translateFlatSeeds(overrides);
  if (translated.schemas) {
    seedActiveStatusesFor(Object.keys(translated.schemas as object));
  }
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

describe("SchemaTree — Sprint 380 MySQL/SQLite sidebar naming + indent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC-380-01 — MySQL: "Schemas" 헤더 label 없음
  // ─────────────────────────────────────────────────────────────────────
  it("AC-380-01 — MySQL hides the 'Schemas' header label entirely", async () => {
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

    // The literal "Schemas" header text must not be present anywhere in
    // the MySQL sidebar (queryByText covers both the sidebar header span
    // and the popover-internal header). Popover is closed by default, so
    // queryByText returns null only if the header span itself is gone.
    expect(screen.queryByText("Schemas")).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC-380-02 — SQLite: "Schemas" 헤더 label 없음
  // ─────────────────────────────────────────────────────────────────────
  it("AC-380-02 — SQLite hides the 'Schemas' header label entirely", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("sl1", "sqlite")],
    });
    setSchemaStoreState({
      schemas: { sl1: [{ name: "main" }] },
      tables: {
        "sl1:main": [{ name: "todos", schema: "main", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="sl1" />);
    });

    expect(screen.queryByText("Schemas")).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC-380-03 — MySQL: category row pl-3
  // ─────────────────────────────────────────────────────────────────────
  it("AC-380-03 — MySQL category row uses pl-3 (no leftover schema-level indent)", async () => {
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

    const tablesCat = screen.getByLabelText("Tables in appdb");
    expect(tablesCat.className).toContain("pl-3");
    expect(tablesCat.className).not.toContain("pl-6");
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC-380-04 — SQLite: item row pl-3 유지
  // ─────────────────────────────────────────────────────────────────────
  it("AC-380-04 — SQLite item (table) row keeps pl-3 (flat-shape, unchanged)", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("sl1", "sqlite")],
    });
    setSchemaStoreState({
      schemas: { sl1: [{ name: "main" }] },
      tables: {
        "sl1:main": [{ name: "todos", schema: "main", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="sl1" />);
    });

    const todoBtn = screen.getByLabelText("todos table");
    expect(todoBtn.className).toContain("pl-3");
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC-380-05 — PG regression: "Schemas" 헤더 라벨 있음
  // ─────────────────────────────────────────────────────────────────────
  it("AC-380-05 — PG keeps the 'Schemas' header label", async () => {
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

    // The sidebar header span carrying the literal text "Schemas" must
    // remain present for PG. (Popover internal "Schemas" header isn't
    // rendered until the popover opens, so this matches a single node.)
    expect(screen.getByText("Schemas")).toBeInTheDocument();
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC-380-06 — PG regression: category row pl-6
  // ─────────────────────────────────────────────────────────────────────
  it("AC-380-06 — PG category row stays at pl-6", async () => {
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

    const tablesCat = screen.getByLabelText("Tables in public");
    expect(tablesCat.className).toContain("pl-6");
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC-380-07 — PG regression: schema row 렌더
  // ─────────────────────────────────────────────────────────────────────
  it("AC-380-07 — PG keeps the schema row rendered", async () => {
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

    expect(screen.getByLabelText("public schema")).toBeInTheDocument();
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC-380-08 — MySQL indent < PG indent (잉여 들여쓰기 제거 확인)
  // ─────────────────────────────────────────────────────────────────────
  it("AC-380-08 — MySQL category indent set differs from PG (less indented)", async () => {
    // Render PG first, capture indent, unmount, then render MySQL.
    useConnectionStore.setState({
      connections: [makeConnection("pg1", "postgresql")],
    });
    setSchemaStoreState({
      schemas: { pg1: [{ name: "public" }] },
      tables: {
        "pg1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    const pg = render(<SchemaTree connectionId="pg1" />);
    await act(async () => {});
    const pgClass = screen.getByLabelText("Tables in public").className;
    pg.unmount();

    // Now MySQL with a fresh store.
    resetStores();
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

    const mysqlClass = screen.getByLabelText("Tables in appdb").className;

    // PG category gets pl-6, MySQL gets pl-3. Compare class strings —
    // they must differ, MySQL must contain pl-3, PG must contain pl-6.
    expect(mysqlClass).not.toBe(pgClass);
    expect(mysqlClass).toContain("pl-3");
    expect(pgClass).toContain("pl-6");
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC-380-09 — MySQL: 4 categories 모두 reachable
  // ─────────────────────────────────────────────────────────────────────
  it("AC-380-09 — MySQL surfaces all 4 categories (Tables/Views/Functions/Procedures)", async () => {
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

    expect(screen.getByLabelText("Tables in appdb")).toBeInTheDocument();
    expect(screen.getByLabelText("Views in appdb")).toBeInTheDocument();
    expect(screen.getByLabelText("Functions in appdb")).toBeInTheDocument();
    expect(screen.getByLabelText("Procedures in appdb")).toBeInTheDocument();
  });

  // ─────────────────────────────────────────────────────────────────────
  // AC-380-10 — MySQL item row pl-7
  // ─────────────────────────────────────────────────────────────────────
  it("AC-380-10 — MySQL item (table) row uses pl-7 (3-way indent: PG pl-10 / MySQL pl-7 / SQLite pl-3)", async () => {
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

    const orderBtn = screen.getByLabelText("orders table");
    expect(orderBtn.className).toContain("pl-7");
    expect(orderBtn.className).not.toContain("pl-10");
    expect(orderBtn.className).not.toContain("pl-3 ");
  });
});
