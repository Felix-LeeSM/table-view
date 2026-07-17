/**
 * `migrateLoadedWorkspaces` — stale `subView: "erd"` fallback.
 *
 * The table-level ERD sub-view was removed (ERD is now a database-level tab).
 * A workspace persisted before that change may still carry a table tab whose
 * `subView === "erd"`. On rehydrate that value must degrade gracefully to
 * `"records"` so the tab renders a live grid instead of an empty/crashing
 * panel. Database-level erd tabs (`type: "erd"`) must survive rehydrate intact
 * so a refresh restores them.
 */
import { describe, expect, it } from "vitest";
import { migrateLoadedWorkspaces } from "./persistence";
import type { WorkspaceState } from "./types";

// Raw persisted shape carries the removed "erd" literal, which the current
// `TabSubView` union no longer allows — cast through `unknown` to model a
// pre-migration blob loaded from storage.
function rawWorkspace(tabs: unknown[]): Partial<WorkspaceState> {
  return { tabs: tabs as WorkspaceState["tabs"], activeTabId: null };
}

describe("migrateLoadedWorkspaces — stale subView: 'erd' fallback", () => {
  it("rewrites a persisted table tab's stale 'erd' subView to 'records'", () => {
    const raw = {
      conn1: {
        db1: rawWorkspace([
          {
            type: "table",
            id: "tab-1",
            title: "public.users",
            connectionId: "conn1",
            closable: true,
            schema: "public",
            table: "users",
            database: "db1",
            subView: "erd",
          },
        ]),
      },
    };

    const out = migrateLoadedWorkspaces(raw);

    const tab = out.conn1!.db1!.tabs[0]!;
    expect(tab.type).toBe("table");
    if (tab.type === "table") {
      expect(tab.subView).toBe("records");
    }
  });

  it("leaves a valid table subView untouched", () => {
    const raw = {
      conn1: {
        db1: rawWorkspace([
          {
            type: "table",
            id: "tab-1",
            title: "public.users",
            connectionId: "conn1",
            closable: true,
            schema: "public",
            table: "users",
            database: "db1",
            subView: "structure",
          },
        ]),
      },
    };

    const out = migrateLoadedWorkspaces(raw);

    const tab = out.conn1!.db1!.tabs[0]!;
    if (tab.type === "table") {
      expect(tab.subView).toBe("structure");
    }
  });

  it("rehydrates a database-level erd tab intact", () => {
    const raw = {
      conn1: {
        db1: rawWorkspace([
          {
            type: "erd",
            id: "tab-1",
            title: "ERD: db1",
            connectionId: "conn1",
            closable: true,
            database: "db1",
          },
        ]),
      },
    };

    const out = migrateLoadedWorkspaces(raw);

    const tab = out.conn1!.db1!.tabs[0]!;
    expect(tab.type).toBe("erd");
    if (tab.type === "erd") {
      expect(tab.database).toBe("db1");
      expect(tab.connectionId).toBe("conn1");
    }
  });
});
