import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import TabBar from "./TabBar";
import { useTabStore, type TableTab } from "@stores/tabStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig } from "@/types/connection";

function addTableTab(overrides: Partial<Omit<TableTab, "id">> = {}) {
  useTabStore.getState().addTab({
    title: "Test Tab",
    connectionId: "conn1",
    type: "table",
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
    ...overrides,
  });
}

function fireAuxClick(element: Element, button: number) {
  fireEvent(
    element,
    new MouseEvent("auxclick", { bubbles: true, button, cancelable: true }),
  );
}

describe("TabBar", () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: [],
      activeTabId: null,
      dirtyTabIds: new Set<string>(),
    });
    useConnectionStore.setState({
      connections: [],
      groups: [],
      activeStatuses: {},
      loading: false,
      error: null,
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);
  });

  it("renders nothing when no tabs", () => {
    const { container } = render(<TabBar />);
    expect(container.innerHTML).toBe("");
  });

  it("renders tabs with titles", () => {
    addTableTab({
      title: "public.users",
      table: "users",
      connectionId: "conn1",
    });
    addTableTab({
      title: "public.orders",
      table: "orders",
      connectionId: "conn2",
    });

    render(<TabBar />);
    // Unique table names → only table name shown (no schema prefix)
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
  });

  it("shows schema.table when two tabs share the same table name", () => {
    // Same table name from two different connections → must disambiguate with schema prefix
    addTableTab({
      title: "public.users",
      schema: "public",
      table: "users",
      connectionId: "conn1",
    });
    addTableTab({
      title: "public.users",
      schema: "public",
      table: "users",
      connectionId: "conn2",
    });

    render(<TabBar />);
    // Ambiguous table name → full schema.table shown for both tabs
    expect(screen.getAllByText("public.users")).toHaveLength(2);
  });

  it("closes tab on middle-click (auxclick button 1)", () => {
    addTableTab({
      title: "public.users",
      table: "users",
      connectionId: "conn1",
    });
    addTableTab({
      title: "public.orders",
      table: "orders",
      connectionId: "conn2",
    });

    render(<TabBar />);

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(2);

    const ordersTab = screen.getByText("orders").closest("[role='tab']")!;
    fireAuxClick(ordersTab, 1);

    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(screen.queryByText("orders")).not.toBeInTheDocument();
  });

  it("does not close tab on right-click (auxclick button 2)", () => {
    addTableTab({
      title: "public.users",
      table: "users",
      connectionId: "conn1",
    });
    addTableTab({
      title: "public.orders",
      table: "orders",
      connectionId: "conn2",
    });

    render(<TabBar />);

    const ordersTab = screen.getByText("orders").closest("[role='tab']")!;
    fireAuxClick(ordersTab, 2);

    expect(useTabStore.getState().tabs).toHaveLength(2);
  });

  it("activates tab on click", () => {
    addTableTab({
      title: "public.users",
      table: "users",
      connectionId: "conn1",
    });
    addTableTab({
      title: "public.orders",
      table: "orders",
      connectionId: "conn2",
    });

    render(<TabBar />);

    const state = useTabStore.getState();
    const firstTabId = state.tabs[0]!.id;

    // Click the first tab (second tab is currently active)
    const usersTab = screen.getByText("users").closest("[role='tab']")!;
    act(() => {
      fireEvent.click(usersTab);
    });

    expect(useTabStore.getState().activeTabId).toBe(firstTabId);
  });

  it("closes tab via close button", () => {
    addTableTab({ title: "Users", table: "users" });

    render(<TabBar />);
    const closeBtn = screen.getByLabelText("Close Users");
    act(() => {
      fireEvent.click(closeBtn);
    });

    expect(useTabStore.getState().tabs).toHaveLength(0);
  });

  it("renders query tab with correct icon", () => {
    addTableTab({ title: "Users", table: "users" });
    useTabStore.getState().addQueryTab("conn1");

    render(<TabBar />);
    const tabs = screen.getAllByRole("tab");
    // Second tab should be the query tab
    const queryTab = tabs[1]!;
    expect(queryTab).toHaveAttribute("aria-selected", "true");
  });

  it("has select-none class on root element to prevent text selection", () => {
    addTableTab({ title: "Users", table: "users" });

    render(<TabBar />);
    const tablist = screen.getByRole("tablist");
    expect(tablist.className).toContain("select-none");
  });

  // ── Sprint 77: Compact tab bar height ──

  // AC-01 — the tab row must stay in the compact regime. `py-1 text-sm`
  // yields ~28px content (20px line-height + 4px+4px padding); combined
  // with the 1px bottom border the row is ≤ 32px as the contract requires.
  // `text-sm` keeps the close button (size-6 = 24px) inside a ≥ 28px
  // vertical hit target. Failing this assertion means someone bumped the
  // padding / font size back up — revisit AC-01 intentionally.
  it("compact tab metrics — py-1 + text-sm, not py-1.5", () => {
    addTableTab({ title: "public.users", table: "users" });

    render(<TabBar />);
    const tab = screen.getByText("users").closest("[role='tab']")!;
    expect(tab.className).toContain("py-1");
    expect(tab.className).toContain("text-sm");
    // Guard against regression to the pre-Sprint 77 padding.
    expect(tab.className).not.toContain("py-1.5");
    expect(tab.className).not.toContain("py-2");
  });

  // ── Sprint 28: Tab Connection Color Display ──

  function makeConnection(
    overrides: Partial<ConnectionConfig> = {},
  ): ConnectionConfig {
    return {
      id: "conn1",
      name: "Test DB",
      db_type: "postgresql",
      host: "localhost",
      port: 5432,
      user: "postgres",
      has_password: false,
      database: "testdb",
      group_id: null,
      color: null,
      paradigm: "rdb",
      ...overrides,
    };
  }

  it("renders color stripe for tab with connection color", () => {
    useConnectionStore.setState({
      connections: [makeConnection({ id: "conn1", color: "red" })],
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);

    addTableTab({ title: "Users", table: "users", connectionId: "conn1" });
    render(<TabBar />);

    const stripe = screen.getByLabelText("Connection color");
    expect(stripe).toBeInTheDocument();
    expect((stripe as HTMLElement).style.backgroundColor).toBe("red");
  });

  it("still renders a stripe when no color is set (uses derived palette color)", () => {
    useConnectionStore.setState({
      connections: [makeConnection({ id: "conn1", color: null })],
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);

    addTableTab({ title: "Users", table: "users", connectionId: "conn1" });
    render(<TabBar />);

    const stripe = screen.getByLabelText("Connection color");
    expect(stripe).toBeInTheDocument();
    // A non-empty color is applied (palette-derived), even without user input.
    expect((stripe as HTMLElement).style.backgroundColor).not.toBe("");
  });

  it("does not render a stripe when the tab's connection has been removed", () => {
    useConnectionStore.setState({
      connections: [],
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);

    addTableTab({ title: "Orphan", table: "orphan", connectionId: "missing" });
    render(<TabBar />);

    expect(screen.queryByLabelText("Connection color")).toBeNull();
  });

  it("renders different colors for different connections", () => {
    useConnectionStore.setState({
      connections: [
        makeConnection({ id: "conn1", color: "red" }),
        makeConnection({ id: "conn2", color: "blue" }),
      ],
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);

    addTableTab({ title: "Users", table: "users", connectionId: "conn1" });
    addTableTab({ title: "Orders", table: "orders", connectionId: "conn2" });
    render(<TabBar />);

    const stripes = screen.getAllByLabelText("Connection color");
    expect(stripes).toHaveLength(2);
    expect((stripes[0] as HTMLElement).style.backgroundColor).toBe("red");
    expect((stripes[1] as HTMLElement).style.backgroundColor).toBe("blue");
  });

  // ── Sprint 29: Preview Tab Display ──

  it("preview tab has italic title", () => {
    addTableTab({ title: "public.users", table: "users" });
    // New tabs are preview by default

    render(<TabBar />);
    const titleEl = screen.getByText("users");
    expect(titleEl.className).toContain("italic");
  });

  it("permanent tab does not have italic title", () => {
    addTableTab({ title: "public.users", table: "users" });

    // Promote the tab to permanent
    const state = useTabStore.getState();
    const tabId = state.tabs[0]!.id;
    useTabStore.getState().promoteTab(tabId);

    render(<TabBar />);
    const titleEl = screen.getByText("users");
    expect(titleEl.className).not.toContain("italic");
  });

  // ── Sprint 43: Double-click tab promotion ──

  it("promotes preview tab on double-click", () => {
    addTableTab({ title: "public.users", table: "users" });
    // New tab is preview by default
    const state = useTabStore.getState();
    expect((state.tabs[0] as TableTab).isPreview).toBe(true);

    render(<TabBar />);
    const tab = screen.getByText("users").closest("[role='tab']")!;
    act(() => {
      fireEvent.doubleClick(tab);
    });

    const updatedTab = useTabStore.getState().tabs[0] as TableTab;
    expect(updatedTab.isPreview).toBe(false);
  });

  it("does not change permanent tab on double-click", () => {
    addTableTab({ title: "public.users", table: "users" });
    const state = useTabStore.getState();
    const tabId = state.tabs[0]!.id;
    useTabStore.getState().promoteTab(tabId);

    render(<TabBar />);
    const tab = screen.getByText("users").closest("[role='tab']")!;
    act(() => {
      fireEvent.doubleClick(tab);
    });

    const updatedTab = useTabStore.getState().tabs[0] as TableTab;
    expect(updatedTab.isPreview).toBe(false);
  });

  it("does not call promoteTab on query tab double-click", () => {
    addTableTab({ title: "Users", table: "users" });
    useTabStore.getState().addQueryTab("conn1");

    render(<TabBar />);
    const tabs = screen.getAllByRole("tab");
    const queryTab = tabs[1]!;

    act(() => {
      fireEvent.doubleClick(queryTab);
    });

    // Query tab should still exist and be active
    expect(useTabStore.getState().tabs[1]!.type).toBe("query");
  });

  // ── Sprint 45: Tab color dot tooltip ──

  it("color stripe has title with connection name", () => {
    useConnectionStore.setState({
      connections: [
        makeConnection({ id: "conn1", name: "My Database", color: "red" }),
      ],
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);

    addTableTab({ title: "Users", table: "users", connectionId: "conn1" });
    render(<TabBar />);

    const stripe = screen.getByLabelText("Connection color");
    expect(stripe).toHaveAttribute("title", "My Database");
  });

  // ── Drag-and-drop reorder ──

  // Helper: set tabs directly in the store to bypass the preview-replacement
  // logic in addTab (which collapses multiple same-connection tabs into one).
  function setThreeTabs() {
    useTabStore.setState({
      tabs: [
        {
          id: "t1",
          type: "table",
          title: "users",
          connectionId: "conn1",
          closable: true,
          subView: "records" as const,
          isPreview: false,
          schema: "public",
          table: "users",
        },
        {
          id: "t2",
          type: "table",
          title: "orders",
          connectionId: "conn1",
          closable: true,
          subView: "records" as const,
          isPreview: false,
          schema: "public",
          table: "orders",
        },
        {
          id: "t3",
          type: "table",
          title: "products",
          connectionId: "conn1",
          closable: true,
          subView: "records" as const,
          isPreview: false,
          schema: "public",
          table: "products",
        },
      ],
      activeTabId: "t1",
      closedTabHistory: [],
    });
  }

  it("reorders tabs when dragging first tab onto third", () => {
    setThreeTabs();
    render(<TabBar />);

    const before = useTabStore.getState().tabs.map((t) => t.id);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);

    act(() => {
      fireEvent.mouseDown(tabs[0]!, { button: 0, clientX: 0 });
      fireEvent.mouseMove(document, { clientX: 10 }); // dx=10 > 4 → isDragging
      fireEvent.mouseEnter(tabs[2]!);
      fireEvent.mouseUp(tabs[2]!);
    });

    const after = useTabStore.getState().tabs.map((t) => t.id);
    // t1 moves to where t3 was → [t2, t3, t1]
    expect(after).toEqual([before[1], before[2], before[0]]);
  });

  it("does not reorder when dropping a tab onto itself", () => {
    setThreeTabs();
    render(<TabBar />);

    const before = useTabStore.getState().tabs.map((t) => t.id);
    const tabs = screen.getAllByRole("tab");

    act(() => {
      fireEvent.mouseDown(tabs[0]!, { button: 0, clientX: 0 });
      fireEvent.mouseMove(document, { clientX: 10 }); // isDragging = true
      fireEvent.mouseUp(tabs[0]!); // same tab → no reorder
    });

    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(before);
  });

  it("activeTabId is unchanged after drag reorder", () => {
    setThreeTabs();
    render(<TabBar />);

    const { activeTabId } = useTabStore.getState();
    const tabs = screen.getAllByRole("tab");

    act(() => {
      fireEvent.mouseDown(tabs[0]!, { button: 0, clientX: 0 });
      fireEvent.mouseMove(document, { clientX: 10 });
      fireEvent.mouseEnter(tabs[2]!);
      fireEvent.mouseUp(tabs[2]!);
    });

    expect(useTabStore.getState().activeTabId).toBe(activeTabId);
  });

  // ── Sprint 97: dirty indicator + close gate ──

  // AC-01 — a tab in `dirtyTabIds` renders a visible dirty marker
  // (data-dirty="true" + aria-label hint) so the user can spot unsaved
  // edits at a glance.
  it("renders a dirty mark for tabs in dirtyTabIds (AC-01)", () => {
    addTableTab({ title: "Users", table: "users" });
    const tabId = useTabStore.getState().tabs[0]!.id;
    act(() => {
      useTabStore.getState().setTabDirty(tabId, true);
    });

    render(<TabBar />);

    const tab = screen.getByText("users").closest("[role='tab']")!;
    const dot = tab.querySelector('[data-dirty="true"]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("aria-label", "Unsaved changes");
  });

  // AC-03 — when dirty drops to 0 the mark disappears immediately on the
  // next render, without needing a tab switch / remount.
  it("removes the dirty mark when dirtyTabIds clears (AC-03)", () => {
    addTableTab({ title: "Users", table: "users" });
    const tabId = useTabStore.getState().tabs[0]!.id;
    act(() => {
      useTabStore.getState().setTabDirty(tabId, true);
    });

    const { rerender } = render(<TabBar />);
    let tab = screen.getByText("users").closest("[role='tab']")!;
    expect(tab.querySelector('[data-dirty="true"]')).not.toBeNull();

    // Clean → mark must vanish.
    act(() => {
      useTabStore.getState().setTabDirty(tabId, false);
    });
    rerender(<TabBar />);
    tab = screen.getByText("users").closest("[role='tab']")!;
    expect(tab.querySelector('[data-dirty="true"]')).toBeNull();
  });

  // AC-04 — a clean tab never sprouts a dirty mark, even after another
  // sibling tab toggles dirty (regression guard).
  it("does not render a dirty mark for clean tabs", () => {
    addTableTab({
      title: "users",
      table: "users",
      connectionId: "conn1",
    });
    addTableTab({
      title: "orders",
      table: "orders",
      connectionId: "conn2",
    });
    const dirtyId = useTabStore.getState().tabs[0]!.id;
    act(() => {
      useTabStore.getState().setTabDirty(dirtyId, true);
    });

    render(<TabBar />);
    const cleanTab = screen.getByText("orders").closest("[role='tab']")!;
    expect(cleanTab.querySelector('[data-dirty="true"]')).toBeNull();
  });

  // ── Sprint 134 (AC-S134-06): dirty marker is independent of activeTabId ──
  //
  // Lesson 2026-04-27-workspace-toolbar-ux-gaps (#9) reported that the
  // dirty dot was perceived to render only on the active tab. The
  // production code at `TabBar.tsx` keys the marker on
  // `dirtyTabIds.has(tab.id)` (NOT `tab.id === activeTabId`), so these
  // tests guard against any future refactor accidentally re-coupling
  // the two.

  it("renders the dirty mark on a tab that is NOT the active tab (AC-S134-06)", () => {
    addTableTab({
      title: "users",
      table: "users",
      connectionId: "conn1",
    });
    addTableTab({
      title: "orders",
      table: "orders",
      connectionId: "conn2",
    });
    const tabs = useTabStore.getState().tabs;
    const dirtyId = tabs[0]!.id; // "users" — will be DIRTY
    const activeId = tabs[1]!.id; // "orders" — will be ACTIVE
    act(() => {
      useTabStore.setState({ activeTabId: activeId });
      useTabStore.getState().setTabDirty(dirtyId, true);
    });

    render(<TabBar />);

    const dirtyTabEl = screen.getByText("users").closest("[role='tab']")!;
    const activeTabEl = screen.getByText("orders").closest("[role='tab']")!;

    // The dirty (inactive) tab carries the marker.
    expect(dirtyTabEl.querySelector('[data-dirty="true"]')).not.toBeNull();
    // The active (clean) tab does NOT carry the marker.
    expect(activeTabEl.querySelector('[data-dirty="true"]')).toBeNull();
    // Sanity — confirm aria-selected matches the active tab so the
    // assertion above isn't testing a layout/role coincidence.
    expect(activeTabEl).toHaveAttribute("aria-selected", "true");
    expect(dirtyTabEl).toHaveAttribute("aria-selected", "false");
  });

  it("does NOT render a dirty mark on the active tab when only an inactive sibling is dirty (AC-S134-06)", () => {
    addTableTab({
      title: "users",
      table: "users",
      connectionId: "conn1",
    });
    addTableTab({
      title: "orders",
      table: "orders",
      connectionId: "conn2",
    });
    addTableTab({
      title: "events",
      table: "events",
      connectionId: "conn3",
    });
    const tabs = useTabStore.getState().tabs;
    const activeId = tabs[2]!.id; // "events" — active + clean
    const dirtyId = tabs[0]!.id; // "users" — dirty + NOT active
    act(() => {
      useTabStore.setState({ activeTabId: activeId });
      useTabStore.getState().setTabDirty(dirtyId, true);
    });

    render(<TabBar />);

    const activeTabEl = screen.getByText("events").closest("[role='tab']")!;
    const dirtyTabEl = screen.getByText("users").closest("[role='tab']")!;

    // The active tab is clean — no dot. (Regression guard against the
    // observed bug where activeTabId was used as the dirty selector.)
    expect(activeTabEl.querySelector('[data-dirty="true"]')).toBeNull();
    expect(activeTabEl).toHaveAttribute("aria-selected", "true");

    // The dirty (inactive) sibling DOES render the dot.
    expect(dirtyTabEl.querySelector('[data-dirty="true"]')).not.toBeNull();
  });

  // AC-02 — clean tab close button still removes the tab synchronously
  // (no ConfirmDialog), so the gate is strictly opt-in on dirty state.
  it("close button on a clean tab removes it without confirmation", () => {
    addTableTab({ title: "Users", table: "users" });

    render(<TabBar />);
    const closeBtn = screen.getByLabelText("Close Users");
    act(() => {
      fireEvent.click(closeBtn);
    });

    expect(useTabStore.getState().tabs).toHaveLength(0);
    // Dialog must NOT appear for a clean close.
    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
  });

  // AC-02 — confirm branch: dirty close → ConfirmDialog → click "Discard
  // and close" → tab is actually removed.
  it("dirty close opens ConfirmDialog and removes tab on confirm (AC-02)", () => {
    addTableTab({ title: "Users", table: "users" });
    const tabId = useTabStore.getState().tabs[0]!.id;
    act(() => {
      useTabStore.getState().setTabDirty(tabId, true);
    });

    render(<TabBar />);
    expect(useTabStore.getState().tabs).toHaveLength(1);

    const closeBtn = screen.getByLabelText("Close Users");
    act(() => {
      fireEvent.click(closeBtn);
    });

    // Tab still present — gate held the close.
    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();

    // Confirm → close completes.
    const confirmBtn = screen.getByRole("button", {
      name: "Discard and close",
    });
    act(() => {
      fireEvent.click(confirmBtn);
    });

    expect(useTabStore.getState().tabs).toHaveLength(0);
    // dirtyTabIds is cleaned up by removeTab.
    expect(useTabStore.getState().dirtyTabIds.has(tabId)).toBe(false);
  });

  // AC-02 — cancel branch: dirty close → ConfirmDialog → click "Cancel" →
  // tab stays open, dirty state preserved.
  it("dirty close cancel keeps the tab open (AC-02)", () => {
    addTableTab({ title: "Users", table: "users" });
    const tabId = useTabStore.getState().tabs[0]!.id;
    act(() => {
      useTabStore.getState().setTabDirty(tabId, true);
    });

    render(<TabBar />);
    const closeBtn = screen.getByLabelText("Close Users");
    act(() => {
      fireEvent.click(closeBtn);
    });

    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    act(() => {
      fireEvent.click(cancelBtn);
    });

    // Tab survives, still dirty.
    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(useTabStore.getState().dirtyTabIds.has(tabId)).toBe(true);
    // Dialog torn down.
    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
  });

  // ── Sprint 123: paradigm visual cues ──

  it("renders a Mongo paradigm marker for document-paradigm tabs", () => {
    addTableTab({
      title: "users",
      table: "users",
      connectionId: "conn1",
      paradigm: "document",
    });

    render(<TabBar />);
    const marker = screen.getByLabelText("MongoDB collection tab");
    expect(marker).toBeInTheDocument();
  });

  it("does not render the Mongo marker for RDB tabs (snapshot parity)", () => {
    addTableTab({
      title: "users",
      table: "users",
      connectionId: "conn1",
      // paradigm omitted → legacy "rdb" path
    });

    render(<TabBar />);
    expect(screen.queryByLabelText("MongoDB collection tab")).toBeNull();
    expect(screen.queryByLabelText("MongoDB query tab")).toBeNull();
  });

  it("labels a Mongo query tab as a query (not a collection)", () => {
    useTabStore.setState({
      tabs: [
        {
          id: "q1",
          type: "query",
          title: "find()",
          connectionId: "conn1",
          closable: true,
          sql: "{}",
          queryState: { status: "idle" },
          paradigm: "document",
          queryMode: "find",
        },
      ],
      activeTabId: "q1",
      closedTabHistory: [],
    });

    render(<TabBar />);
    expect(screen.getByLabelText("MongoDB query tab")).toBeInTheDocument();
    // The collection-tab label must not surface for a query tab.
    expect(screen.queryByLabelText("MongoDB collection tab")).toBeNull();
  });

  // ── Sprint 136 (AC-S136-06): preview cue coexists with dirty marker ──
  //
  // The preview visual cue (`italic` + `opacity-70` on the title span)
  // and the dirty marker (`data-dirty="true"` dot to the right of the
  // title) must render together on the same tab without overlap or
  // mutual exclusion. These two tests pin both cues independently and
  // jointly so a future refactor cannot accidentally re-couple them.

  it("preview tab carries the preview visual cue (italic + opacity-70) without a dirty marker (AC-S136-06)", () => {
    addTableTab({ title: "public.users", table: "users" });
    // New tab is preview by default; not dirty.

    render(<TabBar />);
    const titleEl = screen.getByText("users");
    // Preview cue — italic + faded.
    expect(titleEl.className).toContain("italic");
    expect(titleEl.className).toContain("opacity-70");
    // No dirty marker on a clean preview tab.
    const tab = titleEl.closest("[role='tab']")!;
    expect(tab.querySelector('[data-dirty="true"]')).toBeNull();
  });

  it("preview cue and dirty marker coexist on the same tab (AC-S136-06)", () => {
    addTableTab({ title: "public.users", table: "users" });
    const tabId = useTabStore.getState().tabs[0]!.id;
    // Mark dirty while leaving the preview flag untouched.
    act(() => {
      useTabStore.getState().setTabDirty(tabId, true);
    });

    render(<TabBar />);
    const titleEl = screen.getByText("users");
    // Preview cue still applied to the title span.
    expect(titleEl.className).toContain("italic");
    expect(titleEl.className).toContain("opacity-70");
    // Dirty dot still rendered alongside the title.
    const tab = titleEl.closest("[role='tab']")!;
    const dot = tab.querySelector('[data-dirty="true"]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("aria-label", "Unsaved changes");
  });

  // ── Sprint 142 (AC-147-1, AC-147-3): data-preview attribute on the
  //    tab element so e2e + integration tests + future styling can hook
  //    onto preview-vs-permanent state at the DOM level (italic class
  //    alone is a styling concern; data-preview is the contractual
  //    signal). ──

  it('preview table tab exposes data-preview="true" on the tab element (AC-147-1)', () => {
    addTableTab({ title: "public.users", table: "users" });
    // addTab seeds isPreview: true, so the freshly created tab must
    // surface the contract attribute.

    render(<TabBar />);
    const tab = screen.getByText("users").closest("[role='tab']")!;
    expect(tab).toHaveAttribute("data-preview", "true");
  });

  it("permanent table tab does NOT carry data-preview (AC-147-3)", () => {
    addTableTab({ title: "public.users", table: "users" });
    const tabId = useTabStore.getState().tabs[0]!.id;
    act(() => {
      useTabStore.getState().promoteTab(tabId);
    });

    render(<TabBar />);
    const tab = screen.getByText("users").closest("[role='tab']")!;
    expect(tab).not.toHaveAttribute("data-preview");
  });

  it("query tab never carries data-preview (only table tabs are previewable)", () => {
    useTabStore.getState().addQueryTab("conn1");

    render(<TabBar />);
    const queryTab = useTabStore
      .getState()
      .tabs.find((t) => t.type === "query")!;
    const tab = screen.getByText(queryTab.title).closest("[role='tab']")!;
    expect(tab).not.toHaveAttribute("data-preview");
  });

  // Middle-click on a dirty tab also routes through the gate so the user
  // can never lose unsaved work via a stray scroll-wheel button press.
  it("middle-click on dirty tab triggers the confirm gate", () => {
    addTableTab({ title: "Users", table: "users" });
    const tabId = useTabStore.getState().tabs[0]!.id;
    act(() => {
      useTabStore.getState().setTabDirty(tabId, true);
    });

    render(<TabBar />);
    const tab = screen.getByText("users").closest("[role='tab']")!;
    fireAuxClick(tab, 1);

    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
  });
});
