/**
 * `workspaceStore` selector hooks. Sprint 262 (ADR 0027) TDD slice.
 *
 * Behaviors:
 *   - `useCurrentWorkspaceKey()` derives `(focusedConnId, activeDb)` from
 *     `connectionStore`. Returns `null` when no focused conn or no
 *     active DB.
 *   - `useCurrentWorkspace()` returns the matching `WorkspaceState` or
 *     `null` when the (connId, db) tuple has no entry (lazy create —
 *     entry exists only after first write).
 *
 * Author intent (2026-05-12): lazy-create invariant has to hold at the
 * read seam too — a fresh launch (no writes yet) must return null, not
 * an auto-seeded empty workspace.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useConnectionStore } from "./connectionStore";
import {
  useCurrentWorkspace,
  useCurrentWorkspaceKey,
  useWorkspaceStore,
} from "./workspaceStore";
import type { TableTabInit } from "./workspaceStore/types";

function makeInit(overrides: Partial<TableTabInit> = {}): TableTabInit {
  return {
    type: "table",
    title: "users",
    connectionId: "conn1",
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
    database: "dbA",
    ...overrides,
  };
}

describe("workspaceStore — selectors", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({
      activeStatuses: {},
      focusedConnId: null,
    });
  });

  it("useCurrentWorkspaceKey — null when no connection focused", () => {
    const { result } = renderHook(() => useCurrentWorkspaceKey());
    expect(result.current).toBeNull();
  });

  it("useCurrentWorkspaceKey — derives (connId, db) from focused + activeStatuses", () => {
    useConnectionStore.setState({
      focusedConnId: "conn1",
      activeStatuses: { conn1: { type: "connected", activeDb: "dbA" } },
    });
    const { result } = renderHook(() => useCurrentWorkspaceKey());
    expect(result.current).toEqual({ connId: "conn1", db: "dbA" });
  });

  it("useCurrentWorkspace — null when key resolves but no entry written yet (lazy)", () => {
    useConnectionStore.setState({
      focusedConnId: "conn1",
      activeStatuses: { conn1: { type: "connected", activeDb: "dbA" } },
    });
    const { result } = renderHook(() => useCurrentWorkspace());
    expect(result.current).toBeNull();
  });

  it("useCurrentWorkspace — returns the entry after a write", () => {
    useConnectionStore.setState({
      focusedConnId: "conn1",
      activeStatuses: { conn1: { type: "connected", activeDb: "dbA" } },
    });
    useWorkspaceStore.getState().addTab("conn1", makeInit());

    const { result } = renderHook(() => useCurrentWorkspace());
    expect(result.current).not.toBeNull();
    expect(result.current!.tabs).toHaveLength(1);
  });
});
