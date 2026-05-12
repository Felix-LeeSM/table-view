// Sprint 262 Slice B (2026-05-12) — sidebar wire-up to workspaceStore.
//
// AC-262-05: SchemaTree 의 `selectedNode` / `expanded` 가 workspaceStore 의
// `sidebar` axis 에 read/write 된다. DbSwitcher (=> connectionStore 의
// activeDb) 가 바뀌면 derived workspace key 가 바뀌고, sidebar 가 자동으로
// 새 workspace 의 상태로 swap, 다시 돌아오면 원래 workspace 의 상태가 그대로
// 복원되어야 한다.
//
// 본 파일은 트레이서 불릿: 단일 통합 테스트가 expansion read/write +
// 워크스페이스 격리 + 라운드트립 보존을 한 번에 본다. selectedNode 와
// scrollTop 의 더 좁은 케이스는 후속 RED→GREEN 사이클에서 다룬다.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import {
  setSchemaStoreState,
  resetStores,
} from "./__tests__/schemaTreeTestHelpers";

describe("SchemaTree — workspace-keyed sidebar state (Slice B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("collapsing a schema in db1 swaps cleanly to db2 and restores on swap back", async () => {
    // Sprint 263 — schemaStore caches are now `(connId, db)`-keyed, so
    // seed both db1 and db2 with the same schema list. The activeDb
    // flip below switches workspaces and the auto-expand effect must
    // fire against the new db's freshly-keyed cache.
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

    // 1) Mount 시 auto-expand-all-schemas 효과로 두 스키마 모두 expanded
    //    가 store 에 기록되어야 한다.
    const initialDb1 =
      useWorkspaceStore.getState().workspaces.conn1?.db1?.sidebar.expanded;
    expect(initialDb1).toEqual(["public", "analytics"]);

    // 2) `public` 스키마를 collapse — store 가 그것만 빼고 유지.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("public schema"));
    });
    expect(
      useWorkspaceStore.getState().workspaces.conn1!.db1!.sidebar.expanded,
    ).toEqual(["analytics"]);

    // 3) DbSwitcher 가 activeDb 를 db2 로 옮긴 시뮬레이션.
    await act(async () => {
      useConnectionStore.setState((s) => ({
        activeStatuses: {
          ...s.activeStatuses,
          conn1: { type: "connected", activeDb: "db2" },
        },
      }));
    });

    // db2 workspace 는 fresh — auto-expand 가 다시 두 스키마 모두 expand.
    const db2Expanded =
      useWorkspaceStore.getState().workspaces.conn1?.db2?.sidebar.expanded;
    expect(db2Expanded).toEqual(["public", "analytics"]);

    // db1 의 expanded 는 그대로 보존 (다른 workspace 의 변경에 영향 없음).
    expect(
      useWorkspaceStore.getState().workspaces.conn1!.db1!.sidebar.expanded,
    ).toEqual(["analytics"]);

    // 4) db1 으로 복귀 — UI 는 db1 의 collapsed-public 상태를 다시 보여줘야.
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
      "true",
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

    // SchemaTree 의 스크롤 컨테이너 — `useVirtualizer` 의 getScrollElement
    // 가 가리키는 div. `data-testid` 없이 querySelector 로 잡되, 최상위
    // outer wrapper (가장 첫 .overflow-y-auto) 가 그것.
    const container = document.querySelector(
      ".flex.flex-col.select-none.overflow-y-auto",
    ) as HTMLDivElement;
    expect(container).not.toBeNull();

    // 스크롤 이벤트 발사. jsdom 은 scrollTop 의 reflow 를 시뮬레이션하지
    // 않으므로 우리는 직접 scrollTop 을 세팅한 다음 `scroll` 이벤트를
    // dispatch 해서 production 의 onScroll 경로를 그대로 실행시킨다.
    container.scrollTop = 142;
    await act(async () => {
      container.dispatchEvent(new Event("scroll"));
    });

    expect(
      useWorkspaceStore.getState().workspaces.conn1!.db1!.sidebar.scrollTop,
    ).toBe(142);

    // Remount: 새 인스턴스가 stored scrollTop 을 복원.
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

    // Functions category 는 default collapsed — 열어야 함수 row 가 보임.
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
