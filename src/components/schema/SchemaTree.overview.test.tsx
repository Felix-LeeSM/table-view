// #1217 — 사이드바 조망. 4개 AC 의 user-journey 검증:
//   1. 첫 스키마만 펼침 (신규 시드) + persist 존중.
//   2. 스키마 노드 테이블 수 배지 (접힘 상태에서도 조망).
//   3. 전역 필터 — 전 스키마 대상, 매치 자동 펼침, views/functions 포함.
//   4. flat(SQLite)/no-schema(MySQL) 동일 필터 UX.
// mock 은 lib boundary (schema store actions) 만; 렌더는 실제 SchemaTree.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import {
  dehydrate,
  migrateLoadedWorkspaces,
} from "@stores/workspaceStore/persistence";
import type { ConnectionConfig, DatabaseType } from "@/types/connection";
import {
  setSchemaStoreState,
  resetStores,
} from "./__tests__/schemaTreeTestHelpers";

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

  // ── AC1 — 첫 스키마만 펼침 (신규 시드) ─────────────────────────────────
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

  // ── AC1 — persist 된 펼침 상태 존중 ────────────────────────────────────
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
    // 사용자가 이전 세션에서 analytics 만 펼쳐둔 상태 (public 접힘).
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

  // ── AC1 — 전부 접음 → 재시작(dehydrate/rehydrate) → 여전히 접힘 ──────────
  // seed 가드가 "한 번도 seed 안 됨(null)" 과 "사용자가 전부 접음([])" 을
  // 구분하는지 — persisted `[]` 가 재-seed 로 덮이면 안 된다.
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
    // fresh seed → 첫 스키마(public)만 펼침.
    expect(
      useWorkspaceStore.getState().workspaces.conn1?.db1?.sidebar.expanded,
    ).toEqual(["public"]);

    // 사용자가 유일하게 펼친 스키마를 접음 → expanded === [].
    await act(async () => {
      fireEvent.click(screen.getByLabelText("public schema"));
    });
    expect(
      useWorkspaceStore.getState().workspaces.conn1!.db1!.sidebar.expanded,
    ).toEqual([]);

    // 앱 재시작 시뮬레이션: dehydrate → JSON round-trip → migrate(fresh
    // rehydrate). `[]` 가 array 로 살아남아야 (null 로 강등되면 재-seed 됨).
    const ws = useWorkspaceStore.getState().workspaces.conn1!.db1!;
    const raw = JSON.parse(JSON.stringify({ conn1: { db1: dehydrate(ws) } }));
    const rehydrated = migrateLoadedWorkspaces(raw);
    expect(rehydrated.conn1!.db1!.sidebar.expanded).toEqual([]);
    await act(async () => {
      view.unmount();
    });
    useWorkspaceStore.setState({ workspaces: rehydrated });

    // 새 세션(새 컴포넌트 인스턴스, 새 session ref) — 재-seed 하면 안 됨.
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

  // ── AC2 — 테이블 수 배지 (접힌 상태에서도 조망) ─────────────────────────
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

    // analytics 는 접혀 있어도 (첫 스키마만 펼침) 테이블 수가 보여야 조망 가능.
    const analyticsRow = screen.getByLabelText("analytics schema");
    expect(analyticsRow).toHaveAttribute("aria-expanded", "false");
    expect(analyticsRow).toHaveTextContent("3");
  });

  // ── AC3 — 전역 필터 (전 스키마, 매치 자동 펼침, views 포함) ──────────────
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

    // public.users 매치 → public 펼쳐지고 users 보임.
    expect(screen.getByLabelText("users table")).toBeInTheDocument();
    // analytics 는 접혀 있었지만 view 매치로 자동 펼침 → view 보임.
    expect(screen.getByLabelText("user_activity view")).toBeInTheDocument();
    // 비매치는 숨김.
    expect(screen.queryByLabelText("orders table")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("events table")).not.toBeInTheDocument();

    // 필터 후에도 트리 구조 (roving/treeitem) 유지 — AC5.
    expect(screen.getByRole("tree")).toBeInTheDocument();
  });

  // ── AC4 — flat(SQLite) 동일 필터 UX ────────────────────────────────────
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

  // ── AC3 — 필터가 function 도 매칭 (views/functions 포함 계약) ────────────
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

    // Functions 카테고리는 기본 접힘이지만 매치로 강제 펼침 → 함수 row 보임.
    expect(
      screen.getByLabelText("calc_user_total function"),
    ).toBeInTheDocument();
    // 비매치 table 은 숨김.
    expect(screen.queryByLabelText("orders table")).not.toBeInTheDocument();
  });

  // ── AC4 — 매치 없을 때 placeholder (blank pane 방지) ─────────────────────
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
