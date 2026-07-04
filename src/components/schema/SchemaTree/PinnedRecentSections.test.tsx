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

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

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

  it("caps Recent to the shared default and expands via the collapse toggle (#1309)", () => {
    seed(
      range(7).map((i) => ({
        connectionId: "pg1",
        db: "app",
        schema: "public",
        table: `t${i}`,
        lastUsed: 100 - i, // t0 is most-recent, t6 the oldest
        pinnedAt: null,
      })),
    );
    render(
      <PinnedRecentSections
        connectionId="pg1"
        db="app"
        treeShape="with-schema"
        onOpenTable={vi.fn()}
      />,
    );
    // 7 recents, cap 5 → most-recent 5 shown, oldest 2 hidden behind the toggle.
    expect(screen.getByText("public.t0")).toBeInTheDocument();
    expect(screen.queryByText("public.t6")).toBeNull();

    const toggle = screen.getByTestId("recent-tables-collapse");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("public.t6")).toBeInTheDocument();
  });

  it("does not render the collapse toggle when Recent is at or below the cap", () => {
    seed(
      range(4).map((i) => ({
        connectionId: "pg1",
        db: "app",
        schema: "public",
        table: `t${i}`,
        lastUsed: 100 - i,
        pinnedAt: null,
      })),
    );
    render(
      <PinnedRecentSections
        connectionId="pg1"
        db="app"
        treeShape="with-schema"
        onOpenTable={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("recent-tables-collapse")).toBeNull();
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

  it("Clear recent affordance drops recents but keeps pins (product §1)", () => {
    seed([
      {
        connectionId: "pg1",
        db: "app",
        schema: "public",
        table: "orders",
        lastUsed: 30,
        pinnedAt: 5, // pinned
      },
      {
        connectionId: "pg1",
        db: "app",
        schema: "public",
        table: "users",
        lastUsed: 20,
        pinnedAt: null, // recent-only
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
    // users is under Recent; orders is under Pinned.
    expect(screen.getByText("public.users")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("clearRecentTablesAria"));
    // Recent row gone; pinned row still present.
    expect(screen.queryByText("public.users")).toBeNull();
    expect(screen.getByText("public.orders")).toBeInTheDocument();
  });
});
