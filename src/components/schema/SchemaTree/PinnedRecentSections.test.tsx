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
    expect(screen.getByText("recentHeader")).toBeInTheDocument();
    // #1738 — recents collapse to 0 by default; expand to reveal the row.
    fireEvent.click(screen.getByTestId("recent-tables-collapse"));
    expect(screen.getByText("public.users")).toBeInTheDocument();
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
    // #1738 — collapsed by default; expand to reveal the bare-table row.
    fireEvent.click(screen.getByTestId("recent-tables-collapse"));
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
    // #1738 — collapsed by default; expand before clicking the recent row.
    fireEvent.click(screen.getByTestId("recent-tables-collapse"));
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

  // Reason: #1738 (2026-07-25) — "접으면 완전 숨김(0개; 접힘 시 slice 5→0)".
  // 최근 테이블 섹션은 shared HISTORY_DEFAULT_VISIBLE(5) 대신 0-cap 을 써서
  // 접힘(기본) 상태에서 행을 하나도 렌더하지 않고, 펼치면 전부 노출한다.
  it("hides all recent rows while collapsed and reveals them on expand (#1738)", () => {
    seed(
      range(3).map((i) => ({
        connectionId: "pg1",
        db: "app",
        schema: "public",
        table: `t${i}`,
        lastUsed: 100 - i, // t0 most-recent
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
    // Collapsed by default → header + toggle present, but ZERO recent rows.
    expect(screen.getByText("recentHeader")).toBeInTheDocument();
    expect(screen.queryByText("public.t0")).toBeNull();
    expect(screen.queryByText("public.t2")).toBeNull();

    const toggle = screen.getByTestId("recent-tables-collapse");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("public.t0")).toBeInTheDocument();
    expect(screen.getByText("public.t2")).toBeInTheDocument();
  });

  // Reason: #1738 (2026-07-25) — recent 의 0-cap 접힘은 pinned 섹션에 영향
  // 없음. pinned 은 항상 노출되고, recent 만 접힘(0개) 대상이다.
  it("keeps pinned rows visible while recent rows stay collapsed (#1738)", () => {
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
    // pinned row always visible; recent row hidden until expanded.
    expect(screen.getByText("public.orders")).toBeInTheDocument();
    expect(screen.queryByText("public.users")).toBeNull();
    expect(screen.getByTestId("recent-tables-collapse")).toBeInTheDocument();
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
    // users is under Recent; orders is under Pinned. #1738 — Recent is
    // collapsed by default, so expand it to observe the recent row first.
    fireEvent.click(screen.getByTestId("recent-tables-collapse"));
    expect(screen.getByText("public.users")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("clearRecentTablesAria"));
    // Recent row gone; pinned row still present.
    expect(screen.queryByText("public.users")).toBeNull();
    expect(screen.getByText("public.orders")).toBeInTheDocument();
  });
});
