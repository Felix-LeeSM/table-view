// Issue #2426 — the workspace bottom dock. History, Operations and row
// Details used to live in three places (two bottom flyouts toggled from the
// workspace toolbar, plus a grid-owned Quick Look panel); they are one
// bordered region behind a tab strip now.
//
// `OperationsPanel` is stubbed: this file pins the dock's *routing* and the
// panel has its own suite (`src/components/workspace/OperationsPanel.test.tsx`).
// `GlobalQueryLogPanel` is NOT stubbed — the e2e smoke specs open the query
// log by dispatching `toggle-global-query-log` and then wait for
// `[data-testid="global-query-log-panel"]`, so the real testid has to come out
// of the real routing.

import { useConnectionStore } from "@stores/connectionStore";
import { useLayoutStore } from "@stores/layoutStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionId } from "@/types/branded";
import type { ConnectionConfig } from "@/types/connection";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@components/workspace/OperationsPanel", () => ({
  default: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="stub-operations-panel" /> : null,
}));

import WorkspaceToolbar from "@components/workspace/WorkspaceToolbar";
import BottomPanel from "./BottomPanel";

const PG_CONNECTION = {
  id: "conn-1" as ConnectionId,
  name: "Ops PG",
  dbType: "postgresql",
  host: "localhost",
  port: 5432,
  username: "u",
  database: "postgres",
} as unknown as ConnectionConfig;

function renderDock() {
  return render(<BottomPanel onDetailsSlotChange={() => {}} />);
}

/** Gives `useOperationsConnection` a connected engine that has `operations.*`. */
function seedConnectedPostgres() {
  useConnectionStore.setState({
    connections: [PG_CONNECTION],
    activeStatuses: { [PG_CONNECTION.id]: { type: "connected" } },
    focusedConnId: PG_CONNECTION.id,
  });
}

function tab(name: RegExp): HTMLElement {
  return screen.getByRole("tab", { name });
}

describe("BottomPanel — workspace bottom dock (#2426)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ rows: [] });
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({
      connections: [],
      activeStatuses: {},
      focusedConnId: null,
    });
    // `layoutStore` is reset by the global `beforeEach` in `src/test-setup.ts`.
  });

  it("[bottom-panel] shows the tab strip while the dock is collapsed", () => {
    renderDock();
    expect(useLayoutStore.getState().bottomPanelCollapsed).toBe(true);

    // The strip is the replacement entry point for the two toolbar buttons
    // #2426 deleted, so it cannot be what the collapse hides.
    expect(tab(/history/i)).toBeInTheDocument();
    expect(tab(/details/i)).toBeInTheDocument();
    expect(
      screen.queryByTestId("global-query-log-panel"),
    ).not.toBeInTheDocument();
  });

  it("[bottom-panel] hides the Operations tab when the connection has no operations capability", () => {
    renderDock();
    expect(screen.queryByRole("tab", { name: /operations/i })).toBeNull();

    // ui-parity §4: a capability the engine does not have gets no entry
    // point at all, not a disabled one. Same gate the deleted toolbar button
    // used (`useOperationsConnection` returning null).
    act(() => {
      seedConnectedPostgres();
    });
    expect(tab(/operations/i)).toBeInTheDocument();
  });

  it("[bottom-panel] clicking a tab expands the dock and mounts that view", async () => {
    const user = userEvent.setup();
    renderDock();

    await user.click(tab(/history/i));

    expect(useLayoutStore.getState().bottomPanelCollapsed).toBe(false);
    expect(useLayoutStore.getState().bottomPanelTab).toBe("history");
    expect(await screen.findByTestId("global-query-log-panel")).toBeVisible();
  });

  it("[bottom-panel] switching tabs swaps the view inside the same region", async () => {
    const user = userEvent.setup();
    act(() => {
      seedConnectedPostgres();
    });
    renderDock();

    await user.click(tab(/history/i));
    expect(await screen.findByTestId("global-query-log-panel")).toBeVisible();

    await user.click(tab(/operations/i));

    expect(screen.getByTestId("stub-operations-panel")).toBeInTheDocument();
    expect(
      screen.queryByTestId("global-query-log-panel"),
    ).not.toBeInTheDocument();
    // One dock, not two stacked panels — the pre-#2426 layout rendered both.
    expect(screen.getAllByTestId("workspace-bottom-panel")).toHaveLength(1);
  });

  it("[bottom-panel] clicking the selected tab keeps it open — only the collapse button collapses", async () => {
    const user = userEvent.setup();
    renderDock();

    await user.click(tab(/history/i));
    await user.click(tab(/history/i));
    expect(useLayoutStore.getState().bottomPanelCollapsed).toBe(false);

    await user.click(screen.getByTestId("bottom-panel-toggle-strip"));
    expect(useLayoutStore.getState().bottomPanelCollapsed).toBe(true);
    expect(
      screen.queryByTestId("global-query-log-panel"),
    ).not.toBeInTheDocument();
  });

  it("[bottom-panel] both collapse buttons read one store field and agree on aria-pressed", async () => {
    const user = userEvent.setup();
    render(
      <>
        <WorkspaceToolbar />
        <BottomPanel onDetailsSlotChange={() => {}} />
      </>,
    );
    const inToolbar = () => screen.getByTestId("workspace-bottom-panel-toggle");
    const inStrip = () => screen.getByTestId("bottom-panel-toggle-strip");

    expect(inToolbar()).toHaveAttribute("aria-pressed", "false");
    expect(inStrip()).toHaveAttribute("aria-pressed", "false");

    // Press one, both must move — the owner's requirement was that neither
    // button holds its own copy of the collapsed flag.
    await user.click(inStrip());
    expect(inToolbar()).toHaveAttribute("aria-pressed", "true");
    expect(inStrip()).toHaveAttribute("aria-pressed", "true");

    await user.click(inToolbar());
    expect(inToolbar()).toHaveAttribute("aria-pressed", "false");
    expect(inStrip()).toHaveAttribute("aria-pressed", "false");
  });

  it("[bottom-panel] marks the active tab with a 1px underline and no fill, unlike the editor tab bar", async () => {
    const user = userEvent.setup();
    renderDock();
    await user.click(tab(/history/i));

    const active = tab(/history/i);
    // The editor `TabBar` (one layer up) marks its active tab with
    // `border-b-2 border-b-primary` PLUS a `bg-background` fill; the owner
    // asked the two layers to read differently. This strip differentiates on
    // underline thickness and fill.
    expect(active.className).toContain("border-primary");
    expect(active.className).not.toContain("border-b-2");
    expect(active.className).not.toContain("bg-background");
  });

  it("[bottom-panel] Details shows an empty state until a grid publishes a selected row", async () => {
    const user = userEvent.setup();
    renderDock();

    await user.click(tab(/details/i));
    // Details is bound to a grid selection while History/Operations are bound
    // to the connection. With nothing selected the tab stays enabled and
    // explains itself, so the strip does not gain and lose a tab as the user
    // clicks around the grid.
    expect(screen.getByTestId("bottom-panel-details-empty")).toBeVisible();

    act(() => {
      useLayoutStore.getState().setDetailsAvailable(true);
    });
    expect(screen.queryByTestId("bottom-panel-details-empty")).toBeNull();
  });

  it("[bottom-panel] keeps the Details portal target mounted while another tab is showing", async () => {
    const user = userEvent.setup();
    const slots: (HTMLElement | null)[] = [];
    render(<BottomPanel onDetailsSlotChange={(el) => slots.push(el)} />);

    await user.click(tab(/history/i));
    // A target that appeared only on the render AFTER Details is picked would
    // let the grid paint its panel inline for one frame first.
    expect(slots.filter(Boolean)).not.toHaveLength(0);
    expect(slots[slots.length - 1]).not.toBeNull();

    // Hidden, though — it must not take layout while History owns the dock.
    const detailsPanel = document.getElementById(
      "bottom-panel-tabpanel-details",
    );
    expect(detailsPanel).toHaveAttribute("hidden");
  });

  it("[bottom-panel] falls back to History when the stored tab loses its capability", async () => {
    const user = userEvent.setup();
    act(() => {
      seedConnectedPostgres();
    });
    const { rerender } = renderDock();
    await user.click(tab(/operations/i));
    expect(screen.getByTestId("stub-operations-panel")).toBeInTheDocument();

    // Swapping to an engine without `operations.*` must not leave the dock
    // pointing at a tab that no longer exists.
    act(() => {
      useConnectionStore.setState({
        connections: [],
        activeStatuses: {},
        focusedConnId: null,
      });
    });
    rerender(<BottomPanel onDetailsSlotChange={() => {}} />);

    expect(screen.queryByRole("tab", { name: /operations/i })).toBeNull();
    expect(await screen.findByTestId("global-query-log-panel")).toBeVisible();
    // The pick itself survives, so swapping back restores Operations.
    expect(useLayoutStore.getState().bottomPanelTab).toBe("operations");
  });

  it("[bottom-panel] arrow keys move across the strip", async () => {
    const user = userEvent.setup();
    renderDock();
    const strip = screen.getByRole("tablist", { name: /bottom panel views/i });

    await user.click(tab(/history/i));
    await user.keyboard("{ArrowRight}");

    expect(within(strip).getByRole("tab", { name: /details/i })).toHaveFocus();
    expect(useLayoutStore.getState().bottomPanelTab).toBe("details");
  });
});
