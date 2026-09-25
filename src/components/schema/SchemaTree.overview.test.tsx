// #1217 — sidebar overview. User-journey checks for 4 ACs:
//   1. Only the first schema expands (fresh seed) + persist respected.
//   2. Table-count badge on the schema node (readable while collapsed).
//   3. Global filter — every schema, matches auto-expand, views/functions
//      included.
//   4. flat(SQLite)/no-schema(MySQL) share one filter UX.
// Mocks stop at the lib boundary (schema store actions); the render is the
// real SchemaTree.

import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import {
  dehydrate,
  migrateLoadedWorkspaces,
} from "@stores/workspaceStore/persistence";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig, DatabaseType } from "@/types/connection";
import {
  resetStores,
  setSchemaStoreState,
} from "./__tests__/schemaTreeTestHelpers";
import SchemaTree from "./SchemaTree";

function makeConn(id: string, dbType: DatabaseType): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    dbType,
    host: "localhost",
    port: 5432,
    user: "u",
    hasPassword: false,
    database: "test",
    groupId: null,
    color: null,
    environment: null,
    paradigm:
      dbType === "mongodb" ? "document" : dbType === "redis" ? "kv" : "rdb",
  };
}

describe("SchemaTree — sidebar overview (#1217)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  // ── AC1 — only the first schema expands (fresh seed) ─────────────────────
  it("seeds only the first schema expanded on a fresh workspace", async () => {
    setSchemaStoreState({
      schemas: {
        conn1: [{ name: "public" }, { name: "analytics" }, { name: "audit" }],
      },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
        "conn1:analytics": [
          { name: "events", schema: "analytics", row_count: null },
        ],
        "conn1:audit": [{ name: "trail", schema: "audit", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    expect(screen.getByLabelText("public schema")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByLabelText("analytics schema")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByLabelText("audit schema")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      useWorkspaceStore.getState().workspaces.conn1?.db1?.sidebar.expanded,
    ).toEqual(["public"]);
  });

  // ── AC1 — persisted expansion state is respected ─────────────────────────
  it("respects a persisted expansion instead of re-seeding the first schema", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }, { name: "analytics" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
        "conn1:analytics": [
          { name: "events", schema: "analytics", row_count: null },
        ],
      },
    });
    // The user left only analytics expanded last session (public collapsed).
    useWorkspaceStore.getState().setExpanded("conn1", "db1", ["analytics"]);

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    expect(screen.getByLabelText("public schema")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByLabelText("analytics schema")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  // ── AC1 — collapse all → restart (dehydrate/rehydrate) → still collapsed ─
  // Whether the seed guard separates "never seeded (null)" from "the user
  // collapsed everything ([])" — a persisted `[]` must not be overwritten by a
  // re-seed.
  it("does not re-seed after the user collapses every schema, dehydrate/rehydrate round-trip", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }, { name: "analytics" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
        "conn1:analytics": [
          { name: "events", schema: "analytics", row_count: null },
        ],
      },
    });

    const view = await act(async () =>
      render(<SchemaTree connectionId="conn1" />),
    );
    // fresh seed → only the first schema (public) is expanded.
    expect(
      useWorkspaceStore.getState().workspaces.conn1?.db1?.sidebar.expanded,
    ).toEqual(["public"]);

    // The user collapses the only expanded schema → expanded === [].
    await act(async () => {
      fireEvent.click(screen.getByLabelText("public schema"));
    });
    expect(
      useWorkspaceStore.getState().workspaces.conn1!.db1!.sidebar.expanded,
    ).toEqual([]);

    // Simulate an app restart: dehydrate → JSON round-trip → migrate(fresh
    // rehydrate). `[]` must survive as an array (demoted to null it re-seeds).
    const ws = useWorkspaceStore.getState().workspaces.conn1!.db1!;
    const raw = JSON.parse(JSON.stringify({ conn1: { db1: dehydrate(ws) } }));
    const rehydrated = migrateLoadedWorkspaces(raw);
    expect(rehydrated.conn1!.db1!.sidebar.expanded).toEqual([]);
    await act(async () => {
      view.unmount();
    });
    useWorkspaceStore.setState({ workspaces: rehydrated });

    // New session (new component instance, new session ref) — must not re-seed.
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });
    expect(screen.getByLabelText("public schema")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByLabelText("analytics schema")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      useWorkspaceStore.getState().workspaces.conn1!.db1!.sidebar.expanded,
    ).toEqual([]);
  });

  // ── AC2 — table-count badge (readable while collapsed) ───────────────────
  it("shows a table-count badge on each schema node, visible while collapsed", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }, { name: "analytics" }] },
      tables: {
        "conn1:public": [
          { name: "users", schema: "public", row_count: null },
          { name: "orders", schema: "public", row_count: null },
        ],
        "conn1:analytics": [
          { name: "events", schema: "analytics", row_count: null },
          { name: "page_views", schema: "analytics", row_count: null },
          { name: "sessions", schema: "analytics", row_count: null },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const publicRow = screen.getByLabelText("public schema");
    expect(publicRow).toHaveTextContent("2");

    // analytics is collapsed (only the first schema expands), but its table
    // count must still be visible.
    const analyticsRow = screen.getByLabelText("analytics schema");
    expect(analyticsRow).toHaveAttribute("aria-expanded", "false");
    expect(analyticsRow).toHaveTextContent("3");
  });

  // ── AC3 — global filter (every schema, matches auto-expand, views) ───────
  it("global filter matches across schemas, auto-expands matches, includes views", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }, { name: "analytics" }] },
      tables: {
        "conn1:public": [
          { name: "users", schema: "public", row_count: null },
          { name: "orders", schema: "public", row_count: null },
        ],
        "conn1:analytics": [
          { name: "events", schema: "analytics", row_count: null },
        ],
      },
      views: {
        "conn1:analytics": [
          {
            name: "user_activity",
            schema: "analytics",
            definition: "SELECT 1",
          },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const filter = screen.getByLabelText("Filter all schemas and objects");
    await act(async () => {
      fireEvent.change(filter, { target: { value: "user" } });
    });

    // public.users matches → public expands and users shows.
    expect(screen.getByLabelText("users table")).toBeInTheDocument();
    // analytics was collapsed but auto-expands on the view match → view shows.
    expect(screen.getByLabelText("user_activity view")).toBeInTheDocument();
    // Non-matches are hidden.
    expect(screen.queryByLabelText("orders table")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("events table")).not.toBeInTheDocument();

    // The tree structure (roving/treeitem) survives the filter — AC5.
    expect(screen.getByRole("tree")).toBeInTheDocument();
  });

  // ── AC4 — flat(SQLite) has the same filter UX ────────────────────────────
  it("SQLite flat tree filters tables with the same global filter", async () => {
    useConnectionStore.setState({ connections: [makeConn("sl1", "sqlite")] });
    useConnectionStore.setState((s) => ({
      activeStatuses: {
        ...s.activeStatuses,
        sl1: { type: "connected", activeDb: "db1" },
      },
    }));
    setSchemaStoreState({
      schemas: { sl1: [{ name: "main" }] },
      tables: {
        "sl1:main": [
          { name: "todos", schema: "main", row_count: null },
          { name: "settings", schema: "main", row_count: null },
          { name: "todo_tags", schema: "main", row_count: null },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="sl1" />);
    });

    const filter = screen.getByLabelText("Filter all schemas and objects");
    await act(async () => {
      fireEvent.change(filter, { target: { value: "todo" } });
    });

    expect(screen.getByLabelText("todos table")).toBeInTheDocument();
    expect(screen.getByLabelText("todo_tags table")).toBeInTheDocument();
    expect(screen.queryByLabelText("settings table")).not.toBeInTheDocument();
  });

  // ── AC3 — the filter matches functions too (views/functions contract) ────
  it("global filter matches functions and auto-expands the Functions category", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "orders", schema: "public", row_count: null }],
      },
      functions: {
        "conn1:public": [
          {
            name: "calc_user_total",
            schema: "public",
            arguments: null,
            returnType: "numeric",
            language: "plpgsql",
            source: "BEGIN END",
            kind: "function",
          },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const filter = screen.getByLabelText("Filter all schemas and objects");
    await act(async () => {
      fireEvent.change(filter, { target: { value: "user" } });
    });

    // The Functions category defaults to collapsed, but a match forces it open
    // → the function row shows.
    expect(
      screen.getByLabelText("calc_user_total function"),
    ).toBeInTheDocument();
    // Non-matching tables are hidden.
    expect(screen.queryByLabelText("orders table")).not.toBeInTheDocument();
  });

  // ── AC4 — placeholder when nothing matches (no blank pane) ───────────────
  it("shows a no-matches placeholder when the filter matches nothing", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "orders", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const filter = screen.getByLabelText("Filter all schemas and objects");
    await act(async () => {
      fireEvent.change(filter, { target: { value: "zzz_nonexistent" } });
    });

    expect(screen.getByText("No matching objects")).toBeInTheDocument();
    expect(screen.queryByLabelText("orders table")).not.toBeInTheDocument();
  });
});
