/**
 * 작성 2026-05-17 (Phase 6 sprint-376 Q21 affordance #4).
 *
 * 사유: Group 헤더 우클릭 "Reset collapse states" → 모든 group 의
 * `collapsed` 가 false 가 되도록 `set_group_collapsed` IPC 가 group 수만큼
 * 호출되는지 lock. (set_group_collapsed 는 sprint-369 의 IPC — Q21 의 새
 * IPC 추가 없이 기존 path 재활용. backend reset_group_collapse 같은 bulk
 * IPC 도입하지 않은 이유: per-group write 가 이미 idempotent + cross-window
 * 의 state-changed group.update 가 그대로 흐른다.)
 *
 * 본 sprint 의 contract — confirm dialog 없음 + 직접 IPC.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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

import ConnectionGroup from "./ConnectionGroup";
import { useConnectionStore } from "@stores/connectionStore";
import type {
  ConnectionConfig,
  ConnectionGroup as ConnectionGroupType,
} from "@/types/connection";

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

function makeConnection(id: string, group_id: string | null): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    has_password: false,
    database: "test",
    group_id,
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
