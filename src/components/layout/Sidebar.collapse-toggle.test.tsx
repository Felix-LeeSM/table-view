/**
 * 작성 2026-05-17 (sprint-379 collapse/expand all toggle per DB type).
 *
 * 사유: Sidebar header 의 "Collapse all" 단일 버튼이 사용자 캡처 (이미지 #4)
 * 처럼 *PG 만 commitment* 되어 있던 것을 4 DB type (PG / MySQL / SQLite /
 * Mongo) 각각 적절한 객체 이름으로 노출하고, *현재 상태가 모두 collapsed*
 * 이면 같은 버튼이 "Expand all *" 로 토글되도록 격상한다.
 *
 * 4 DB type × 2 state = 8 RTL.
 *
 * Confirm dialog 없음 (Q21 contract 와 동일 정신).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() =>
    Promise.resolve(),
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@lib/window-label", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return {
    ...actual,
    getCurrentWindowLabel: vi.fn(() => "workspace-c1"),
  };
});

// jsdom localStorage shim (mirrors Sidebar.test.tsx).
{
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

vi.mock("@components/theme/ThemePicker", () => ({
  default: () => <div data-testid="theme-picker-mock" />,
}));

vi.mock("./WorkspaceSidebar", () => ({
  default: ({ selectedId }: { selectedId: string | null }) => (
    <div data-testid="schema-panel">{selectedId ?? "none"}</div>
  ),
}));

import Sidebar from "./Sidebar";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import {
  setFakeWindowConnectionId,
  resetFakeWindowConnectionId,
} from "@/stores/__tests__/fakeWindowConnectionId";
import type {
  ConnectionConfig,
  DatabaseType,
  Paradigm,
} from "@/types/connection";

function makeConnection(
  id: string,
  dbType: DatabaseType,
  paradigm: Paradigm,
): ConnectionConfig {
  return {
    id,
    name: `${id} ${dbType}`,
    dbType: dbType,
    host: "localhost",
    port: 5432,
    user: "x",
    hasPassword: false,
    database: "test",
    groupId: null,
    color: null,
    environment: null,
    paradigm,
  };
}

function seed(opts: {
  dbType: DatabaseType;
  paradigm: Paradigm;
  expanded: string[];
}): void {
  useConnectionStore.setState({
    connections: [makeConnection("c1", opts.dbType, opts.paradigm)],
    activeStatuses: { c1: { type: "connected", activeDb: "db1" } },
    focusedConnId: null,
  });
  useWorkspaceStore.setState({
    workspaces: {
      c1: {
        db1: {
          tabs: [],
          activeTabId: null,
          closedTabHistory: [],
          dirtyTabIds: [],
          sidebar: {
            selectedNode: null,
            expanded: opts.expanded,
            scrollTop: 0,
          },
        },
      },
    },
  });
  setFakeWindowConnectionId("c1");
}

describe("Sidebar collapse/expand-all toggle per DB type (sprint-379)", () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  afterEach(() => {
    resetFakeWindowConnectionId();
  });

  // ── PostgreSQL ──────────────────────────────────────────────────────────
  it("AC-379-01: PG + expanded≥1 → label 'Collapse all schemas', 클릭 → expanded=[]", () => {
    seed({
      dbType: "postgresql",
      paradigm: "rdb",
      expanded: ["schema.public"],
    });
    render(<Sidebar />);
    const btn = screen.getByRole("button", { name: /collapse all schemas/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(
      useWorkspaceStore.getState().workspaces["c1"]?.["db1"]?.sidebar.expanded,
    ).toEqual([]);
  });

  it("AC-379-02: PG + expanded=[] → label 'Expand all schemas'", () => {
    seed({ dbType: "postgresql", paradigm: "rdb", expanded: [] });
    render(<Sidebar />);
    expect(
      screen.getByRole("button", { name: /expand all schemas/i }),
    ).toBeInTheDocument();
  });

  // ── MySQL ───────────────────────────────────────────────────────────────
  it("AC-379-03: MySQL + expanded≥1 → label 'Collapse all tables', 클릭 → expanded=[]", () => {
    seed({
      dbType: "mysql",
      paradigm: "rdb",
      expanded: ["table.users"],
    });
    render(<Sidebar />);
    const btn = screen.getByRole("button", { name: /collapse all tables/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(
      useWorkspaceStore.getState().workspaces["c1"]?.["db1"]?.sidebar.expanded,
    ).toEqual([]);
  });

  it("AC-379-04: MySQL + expanded=[] → label 'Expand all tables'", () => {
    seed({ dbType: "mysql", paradigm: "rdb", expanded: [] });
    render(<Sidebar />);
    expect(
      screen.getByRole("button", { name: /expand all tables/i }),
    ).toBeInTheDocument();
  });

  // ── SQLite ──────────────────────────────────────────────────────────────
  it("AC-379-05: SQLite + expanded≥1 → label 'Collapse all tables', 클릭 → expanded=[]", () => {
    seed({
      dbType: "sqlite",
      paradigm: "rdb",
      expanded: ["table.t1"],
    });
    render(<Sidebar />);
    const btn = screen.getByRole("button", { name: /collapse all tables/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(
      useWorkspaceStore.getState().workspaces["c1"]?.["db1"]?.sidebar.expanded,
    ).toEqual([]);
  });

  it("AC-379-06: SQLite + expanded=[] → label 'Expand all tables'", () => {
    seed({ dbType: "sqlite", paradigm: "rdb", expanded: [] });
    render(<Sidebar />);
    expect(
      screen.getByRole("button", { name: /expand all tables/i }),
    ).toBeInTheDocument();
  });

  // ── MongoDB ─────────────────────────────────────────────────────────────
  it("AC-379-07: Mongo + expanded≥1 → label 'Collapse all collections', 클릭 → expanded=[]", () => {
    seed({
      dbType: "mongodb",
      paradigm: "document",
      expanded: ["coll.docs"],
    });
    render(<Sidebar />);
    const btn = screen.getByRole("button", {
      name: /collapse all collections/i,
    });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(
      useWorkspaceStore.getState().workspaces["c1"]?.["db1"]?.sidebar.expanded,
    ).toEqual([]);
  });

  it("AC-379-08: Mongo + expanded=[] → label 'Expand all collections'", () => {
    seed({ dbType: "mongodb", paradigm: "document", expanded: [] });
    render(<Sidebar />);
    expect(
      screen.getByRole("button", { name: /expand all collections/i }),
    ).toBeInTheDocument();
  });
});
