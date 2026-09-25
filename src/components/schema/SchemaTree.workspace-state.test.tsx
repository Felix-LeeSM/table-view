// Sidebar wire-up to workspaceStore.
//
// AC-262-05: SchemaTree's `selectedNode` / `expanded` read and write the
// `sidebar` axis of workspaceStore. When DbSwitcher (=> connectionStore's
// activeDb) changes, the derived workspace key changes and the sidebar swaps
// to the new workspace's state; coming back must restore the original
// workspace's state unchanged.
//
// This file is a tracer bullet: one integration test covers expansion
// read/write + workspace isolation + round-trip preservation at once. The
// narrower selectedNode and scrollTop cases are left to later RED→GREEN
// cycles.

import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetStores,
  setSchemaStoreState,
} from "./__tests__/schemaTreeTestHelpers";
import SchemaTree from "./SchemaTree";

describe("SchemaTree — workspace-keyed sidebar state (Slice B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("collapsing a schema in db1 swaps cleanly to db2 and restores on swap back", async () => {
    // schemaStore caches are now `(connId, db)`-keyed, so seed both db1 and
    // db2 with the same schema list. The activeDb flip below switches
    // workspaces and the auto-expand effect must fire against the new db's
    // freshly-keyed cache.
    setSchemaStoreState({
      schemas: {
        conn1: {
          db1: [{ name: "public" }, { name: "analytics" }],
          db2: [{ name: "public" }, { name: "analytics" }],
        },
      },
      tables: {},
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // 1) #1217 — on mount only the first schema is recorded as seed expanded.
    const initialDb1 =
      useWorkspaceStore.getState().workspaces.conn1?.db1?.sidebar.expanded;
    expect(initialDb1).toEqual(["public"]);

    // 2) Collapse the `public` schema — the store drops only that entry
    //    (empty array).
    await act(async () => {
      fireEvent.click(screen.getByLabelText("public schema"));
    });
    expect(
      useWorkspaceStore.getState().workspaces.conn1!.db1!.sidebar.expanded,
    ).toEqual([]);

    // 3) Simulate DbSwitcher moving activeDb to db2.
    await act(async () => {
      useConnectionStore.setState((s) => ({
        activeStatuses: {
          ...s.activeStatuses,
          conn1: { type: "connected", activeDb: "db2" },
        },
      }));
    });

    // The db2 workspace is fresh — the seed expands only the first schema again.
    const db2Expanded =
      useWorkspaceStore.getState().workspaces.conn1?.db2?.sidebar.expanded;
    expect(db2Expanded).toEqual(["public"]);

    // db1's expanded is preserved (a change in another workspace does not
    // affect it).
    expect(
      useWorkspaceStore.getState().workspaces.conn1!.db1!.sidebar.expanded,
    ).toEqual([]);

    // 4) Back to db1 — the UI must show db1's collapsed state again (the
    //    seed runs once per session ref; persist is respected, so no
    //    re-seed).
    await act(async () => {
      useConnectionStore.setState((s) => ({
        activeStatuses: {
          ...s.activeStatuses,
          conn1: { type: "connected", activeDb: "db1" },
        },
      }));
    });

    expect(screen.getByLabelText("public schema")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByLabelText("analytics schema")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("persists scrollTop to workspace.sidebar on scroll, and restores on remount", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
    });

    const { unmount } = await act(async () => {
      return render(<SchemaTree connectionId="conn1" />);
    });

    // SchemaTree's scroll container — the div `useVirtualizer`'s
    // getScrollElement points at. Grabbed with querySelector, not a
    // `data-testid`; it is the outermost wrapper (the first
    // .overflow-y-auto).
    const container = document.querySelector(
      ".flex.flex-col.select-none.overflow-y-auto",
    ) as HTMLDivElement;
    expect(container).not.toBeNull();

    // Fire the scroll event. jsdom does not simulate the reflow of scrollTop,
    // so we set scrollTop directly and then dispatch a `scroll` event to run
    // production's onScroll path as is.
    container.scrollTop = 142;
    // #1238 — the scroll event arms @tanstack/virtual-core's isScrolling-reset
    // debounce (a 150ms `setTimeout`, see `isScrollingResetDelay`). React's
    // onScroll writes scrollTop synchronously, but the virtualizer's debounce
    // is *not* cleared by unmount cleanup. Left pending, it fires after jsdom
    // teardown and crashes the whole vitest run with an unhandled
    // `ReferenceError: window is not defined`. Fake timers let us flush it
    // deterministically here, while the window still exists.
    vi.useFakeTimers();
    try {
      await act(async () => {
        container.dispatchEvent(new Event("scroll"));
      });
      act(() => {
        vi.runOnlyPendingTimers();
      });
    } finally {
      vi.useRealTimers();
    }

    expect(
      useWorkspaceStore.getState().workspaces.conn1!.db1!.sidebar.scrollTop,
    ).toBe(142);

    // Remount: the new instance restores the stored scrollTop.
    await act(async () => {
      unmount();
    });

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const newContainer = document.querySelector(
      ".flex.flex-col.select-none.overflow-y-auto",
    ) as HTMLDivElement;
    expect(newContainer.scrollTop).toBe(142);
  });

  it("selectedNode (function click) flows through workspaceStore.sidebar.selectedNode", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": [] },
      functions: {
        "conn1:public": [
          {
            name: "do_thing",
            schema: "public",
            arguments: null,
            returnType: "void",
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

    // The Functions category is collapsed by default — open it to see the
    // function row.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Functions in public"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("do_thing"));
    });

    const selected =
      useWorkspaceStore.getState().workspaces.conn1!.db1!.sidebar.selectedNode;
    // `nodeIdToString({ type: "function", schema, functionName })` uses
    // `:` separator (see treeRows.ts) — record the actual contract.
    expect(selected).toBe("function:public:do_thing");
  });
});
