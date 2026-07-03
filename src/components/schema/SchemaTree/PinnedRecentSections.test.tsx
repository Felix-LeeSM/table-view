import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PinnedRecentSections } from "./PinnedRecentSections";
import {
  useTableActivityStore,
  __resetTableActivityStoreForTests,
  type TableActivityEntry,
} from "@stores/tableActivityStore";

// #1218 — sidebar Pinned/Recent sections. IPC is mocked so store mutates stay
// window-local; i18n keys fall back to the key name under the test i18n stub.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && "table" in opts ? `${key}:${opts.table}` : key,
  }),
}));

function seed(entries: TableActivityEntry[]) {
  useTableActivityStore.setState({ entries });
}

beforeEach(() => {
  __resetTableActivityStoreForTests();
});

describe("PinnedRecentSections", () => {
  it("renders nothing when there is no activity for the (connectionId, db)", () => {
    const { container } = render(
      <PinnedRecentSections
        connectionId="pg1"
        db="app"
        treeShape="with-schema"
        onOpenTable={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("qualifies with-schema recents as schema.table", () => {
    seed([
      {
        connectionId: "pg1",
        db: "app",
        schema: "public",
        table: "users",
        lastUsed: 10,
        pinnedAt: null,
      },
    ]);
    render(
      <PinnedRecentSections
        connectionId="pg1"
        db="app"
        treeShape="with-schema"
        onOpenTable={vi.fn()}
      />,
    );
    expect(screen.getByText("public.users")).toBeInTheDocument();
    expect(screen.getByText("recentHeader")).toBeInTheDocument();
  });

  it("shows the bare table for flat SQLite (schema null)", () => {
    seed([
      {
        connectionId: "sl1",
        db: "main.db",
        schema: null,
        table: "todos",
        lastUsed: 10,
        pinnedAt: null,
      },
    ]);
    render(
      <PinnedRecentSections
        connectionId="sl1"
        db="main.db"
        treeShape="flat"
        onOpenTable={vi.fn()}
      />,
    );
    expect(screen.getByText("todos")).toBeInTheDocument();
  });

  it("clicking a recent row reuses onOpenTable with (table, schema)", () => {
    const onOpenTable = vi.fn();
    seed([
      {
        connectionId: "pg1",
        db: "app",
        schema: "public",
        table: "users",
        lastUsed: 10,
        pinnedAt: null,
      },
    ]);
    render(
      <PinnedRecentSections
        connectionId="pg1"
        db="app"
        treeShape="with-schema"
        onOpenTable={onOpenTable}
      />,
    );
    fireEvent.click(screen.getByText("public.users"));
    expect(onOpenTable).toHaveBeenCalledWith("users", "public");
  });

  it("renders a Pinned section separate from Recent and doesn't double-list", () => {
    seed([
      {
        connectionId: "pg1",
        db: "app",
        schema: "public",
        table: "orders",
        lastUsed: 20,
        pinnedAt: 5, // pinned AND recently used
      },
      {
        connectionId: "pg1",
        db: "app",
        schema: "public",
        table: "users",
        lastUsed: 10,
        pinnedAt: null,
      },
    ]);
    render(
      <PinnedRecentSections
        connectionId="pg1"
        db="app"
        treeShape="with-schema"
        onOpenTable={vi.fn()}
      />,
    );
    expect(screen.getByText("pinnedHeader")).toBeInTheDocument();
    // orders is pinned -> only under Pinned, not duplicated under Recent.
    expect(screen.getAllByText("public.orders")).toHaveLength(1);
  });

  it("the pin toggle unpins a pinned table via the store", () => {
    seed([
      {
        connectionId: "pg1",
        db: "app",
        schema: "public",
        table: "orders",
        lastUsed: 20,
        pinnedAt: 5,
      },
    ]);
    render(
      <PinnedRecentSections
        connectionId="pg1"
        db="app"
        treeShape="with-schema"
        onOpenTable={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("unpinTableAria:orders"));
    expect(
      useTableActivityStore.getState().isPinned({
        connectionId: "pg1",
        db: "app",
        schema: "public",
        table: "orders",
      }),
    ).toBe(false);
  });
});
