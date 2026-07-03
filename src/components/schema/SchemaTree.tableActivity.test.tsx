// #1218 (#1232 review, blocking 3a) — end-to-end wiring lock: the three
// table-open handlers in `useSchemaTreeActions` must record table activity so
// the Pinned/Recent sections populate. Without this test the recording call
// could be dropped and every other spec would still pass green.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, screen, fireEvent, act } from "@testing-library/react";

import SchemaTree from "./SchemaTree";
import { useSafeModeStore } from "@stores/safeModeStore";
import {
  useTableActivityStore,
  selectRecentTables,
  __resetTableActivityStoreForTests,
} from "@stores/tableActivityStore";
import {
  mockLoadSchemas,
  mockLoadTables,
  setSchemaStoreState,
  resetStores,
} from "./__tests__/schemaTreeTestHelpers";

beforeEach(() => {
  vi.clearAllMocks();
  setupTauriMock({ listTables: vi.fn().mockResolvedValue([]) });
  mockLoadSchemas.mockResolvedValue(undefined);
  mockLoadTables.mockResolvedValue(undefined);
  resetStores();
  useSafeModeStore.setState({ mode: "off" });
  __resetTableActivityStoreForTests();
});

async function renderWithTable() {
  setSchemaStoreState({
    schemas: { conn1: [{ name: "public" }] },
    tables: {
      "conn1:public": [{ name: "users", schema: "public", row_count: null }],
    },
  });
  await act(async () => {
    render(<SchemaTree connectionId="conn1" />);
  });
}

describe("SchemaTree — table activity wiring (#1218)", () => {
  it("records a table-level open when a table is clicked", async () => {
    await renderWithTable();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("users table"));
    });

    const recorded = useTableActivityStore
      .getState()
      .entries.find((e) => e.table === "users" && e.connectionId === "conn1");
    expect(recorded).toBeDefined();
    expect(recorded!.schema).toBe("public");
    expect(typeof recorded!.lastUsed).toBe("number");
  });

  it("surfaces the opened table under the Recent section", async () => {
    await renderWithTable();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("users table"));
    });

    const db = useTableActivityStore.getState().entries[0]!.db;
    const recent = selectRecentTables(
      useTableActivityStore.getState().entries,
      "conn1",
      db,
    );
    expect(recent.map((e) => e.table)).toContain("users");
    // The Recent section renders the qualified label (with-schema default).
    expect(screen.getByText("public.users")).toBeInTheDocument();
  });

  it("records via the Structure context-menu entry point too", async () => {
    await renderWithTable();

    await act(async () => {
      fireEvent.contextMenu(screen.getByLabelText("users table"), {
        clientX: 10,
        clientY: 10,
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Structure"));
    });

    const recorded = useTableActivityStore
      .getState()
      .entries.find((e) => e.table === "users");
    expect(recorded).toBeDefined();
  });
});
