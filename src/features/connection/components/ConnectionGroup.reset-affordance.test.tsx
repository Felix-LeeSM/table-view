/**
 * Written 2026-05-17 (Q21 affordance #4).
 *
 * Reason: locks that the group header's right-click "Reset collapse states"
 * calls the `set_group_collapsed` IPC once per group so that every group's
 * `collapsed` becomes false. (set_group_collapsed is an existing IPC — Q21
 * reuses that path instead of adding a new IPC. No bulk IPC such as a backend
 * reset_group_collapse is introduced because the per-group write is already
 * idempotent.)
 *
 * Contract — no confirm dialog, direct IPC.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() =>
    Promise.resolve(),
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

// Mock GroupDialog so we don't render its full form.
vi.mock("./GroupDialog", () => ({
  default: () => <div data-testid="group-dialog-mock" />,
}));

import { useConnectionStore } from "@stores/connectionStore";
import type {
  ConnectionConfig,
  ConnectionGroup as ConnectionGroupType,
} from "@/types/connection";
import ConnectionGroup from "./ConnectionGroup";

function makeGroup(
  id: string,
  collapsed = true,
  name = `group-${id}`,
): ConnectionGroupType {
  return {
    id,
    name,
    color: null,
    collapsed,
  };
}

function makeConnection(id: string, groupId: string | null): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    hasPassword: false,
    database: "test",
    groupId,
    color: null,
    environment: null,
    paradigm: "rdb",
  };
}

describe("ConnectionGroup reset affordance (Q21 #4)", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    useConnectionStore.setState({
      connections: [makeConnection("c-1", "g-1"), makeConnection("c-2", "g-2")],
      groups: [
        makeGroup("g-1", true),
        makeGroup("g-2", true),
        makeGroup("g-3", true),
      ],
      activeStatuses: {},
      focusedConnId: null,
    });
  });

  it("AC-376-04: 우클릭 메뉴 'Reset collapse states' → 모든 group 의 collapsed=false UPDATE IPC", () => {
    const group = makeGroup("g-1", true);
    render(<ConnectionGroup group={group} connections={[]} />);

    // Open context menu by right-click.
    const trigger = screen.getByRole("button", {
      name: /group-g-1 group/i,
    });
    fireEvent.contextMenu(trigger);

    const resetItem = screen.getByRole("menuitem", {
      name: /reset collapse states/i,
    });
    fireEvent.click(resetItem);

    const calls = invokeMock.mock.calls.filter(
      (call) => call[0] === "set_group_collapsed",
    );
    // 3 groups × 1 invocation each.
    expect(calls).toHaveLength(3);
    const seen = new Set<string>();
    for (const call of calls) {
      const arg = call[1] as
        | { req?: { groupId?: string; collapsed?: boolean } }
        | undefined;
      const gid = arg?.req?.groupId;
      const collapsedValue = arg?.req?.collapsed;
      if (gid != null) seen.add(gid);
      expect(collapsedValue).toBe(false);
    }
    expect(seen).toEqual(new Set(["g-1", "g-2", "g-3"]));
  });
});
