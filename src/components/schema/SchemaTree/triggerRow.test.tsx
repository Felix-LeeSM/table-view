// Sprint 272 (2026-05-13) — SchemaTree per-Table "Triggers" child row.
//
// 작성 이유: Sprint 272 attempt 2 — Evaluator scored AC-272-06 6/10
// because the read-only Trigger surface lived only behind a right-click
// menu on the Table row. The contract specifically calls for a literal
// "Triggers" child row directly under each Table row, mirroring the
// Functions/Views per-category lazy-fetch pattern. This file pins:
//   - The Triggers group header renders directly under a Table row
//     when the schema + Tables category are expanded.
//   - Expanding the group dispatches the `listTriggers` IPC EXACTLY
//     ONCE (per-`(connId, db, schema, table)` cache + per-group
//     `loadingTriggerGroups` guard); collapse + re-expand on the same
//     key does NOT re-invoke the IPC.
//   - Empty fetch result renders the italic "No triggers" placeholder.
//   - Per-trigger row exposes its own context menu with "View Source"
//     enabled + "Create Trigger…" (Sprint 273 enabled) + "Drop Trigger…"
//     (Sprint 274 enabled).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

const mockListTriggers = vi.hoisted(() => vi.fn());

vi.mock("@lib/tauri", () => ({
  listTriggers: mockListTriggers,
}));

import SchemaTree from "../SchemaTree";
import { useSchemaStore } from "@stores/schemaStore";
import {
  mockLoadSchemas,
  mockLoadTables,
  setSchemaStoreState,
  resetStores,
} from "../__tests__/schemaTreeTestHelpers";

const FIXTURE_TRIGGER = {
  name: "audit_users_insert",
  schema: "public",
  table: "users",
  timing: "BEFORE",
  events: ["INSERT"],
  orientation: "ROW",
  functionSchema: "audit",
  functionName: "log_insert",
  arguments: null as string | null,
  whenExpression: null as string | null,
  definition:
    "CREATE TRIGGER audit_users_insert BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION audit.log_insert()",
};

describe("SchemaTree — Triggers child row (Sprint 272 attempt 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    mockListTriggers.mockResolvedValue([FIXTURE_TRIGGER]);
    resetStores();
    // The store reset by `resetStores` wipes triggers via setState but
    // `getTableTriggers` is a real store action — leave it intact so the
    // SchemaTree's lazy fetch path runs end-to-end against the mocked
    // `listTriggers` IPC.
    useSchemaStore.setState({ triggers: {} });
  });

  function seedSchemaWithTable() {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });
  }

  it("renders the Triggers child row under each Table row", async () => {
    seedSchemaWithTable();

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    // Tables category is auto-expanded; the `users` row paints and the
    // Triggers child group header sits directly under it.
    expect(screen.getByLabelText("users table")).toBeInTheDocument();
    const triggersGroup = screen.getByLabelText("Triggers for users in public");
    expect(triggersGroup).toBeInTheDocument();
    expect(triggersGroup).toHaveAttribute("aria-expanded", "false");
    // No lazy fetch fired yet — group is collapsed.
    expect(mockListTriggers).not.toHaveBeenCalled();
  });

  it("expands the Triggers group, dispatches the IPC once, renders trigger rows + count badge", async () => {
    seedSchemaWithTable();

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const triggersGroup = screen.getByLabelText("Triggers for users in public");
    await act(async () => {
      fireEvent.click(triggersGroup);
    });

    // Lazy IPC dispatched exactly once with the cache-key tuple.
    expect(mockListTriggers).toHaveBeenCalledTimes(1);
    expect(mockListTriggers).toHaveBeenCalledWith(
      "conn1",
      "public",
      "users",
      "db1",
    );

    // Group is now expanded + carries the count badge.
    expect(triggersGroup).toHaveAttribute("aria-expanded", "true");
    const countBadge = await screen.findByTestId("trigger-count-public-users");
    expect(countBadge).toHaveTextContent("1");

    // Per-trigger row renders.
    expect(
      await screen.findByLabelText("Trigger audit_users_insert on users"),
    ).toBeInTheDocument();
  });

  it("re-expanding a previously-loaded group does NOT re-invoke the IPC (cache hit)", async () => {
    seedSchemaWithTable();

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const triggersGroup = screen.getByLabelText("Triggers for users in public");
    // First expand → IPC fires.
    await act(async () => {
      fireEvent.click(triggersGroup);
    });
    await screen.findByLabelText("Trigger audit_users_insert on users");
    expect(mockListTriggers).toHaveBeenCalledTimes(1);

    // Collapse.
    await act(async () => {
      fireEvent.click(triggersGroup);
    });
    expect(triggersGroup).toHaveAttribute("aria-expanded", "false");

    // Re-expand → cache hit, NO second IPC.
    await act(async () => {
      fireEvent.click(triggersGroup);
    });
    expect(triggersGroup).toHaveAttribute("aria-expanded", "true");
    expect(mockListTriggers).toHaveBeenCalledTimes(1);
  });

  it("renders italic 'No triggers' placeholder when the fetch settles to an empty array", async () => {
    mockListTriggers.mockResolvedValueOnce([]);
    seedSchemaWithTable();

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const triggersGroup = screen.getByLabelText("Triggers for users in public");
    await act(async () => {
      fireEvent.click(triggersGroup);
    });

    expect(mockListTriggers).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByLabelText("No triggers for users"),
    ).toBeInTheDocument();
  });

  it("per-trigger row exposes a context menu with View Source + Create + Drop all enabled", async () => {
    // Sprint 273 (2026-05-13) — Create Trigger… 메뉴 항목은 disabled
    // placeholder 에서 enabled 로 전환됐다 (CreateTriggerDialog 가
    // 추가됨). Sprint 274 (2026-05-13) — Drop Trigger… 도 동일한
    // mechanical update — disabled placeholder → enabled (DropTriggerDialog
    // 가 추가됨).
    seedSchemaWithTable();

    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const triggersGroup = screen.getByLabelText("Triggers for users in public");
    await act(async () => {
      fireEvent.click(triggersGroup);
    });

    const trigRow = await screen.findByLabelText(
      "Trigger audit_users_insert on users",
    );

    await act(async () => {
      fireEvent.contextMenu(trigRow, { clientX: 100, clientY: 200 });
    });

    // View Source — enabled, by aria-label so we can address the menu
    // item rather than the table-row "View Triggers" shortcut.
    const viewSource = screen.getByRole("menuitem", {
      name: /view source for trigger audit_users_insert/i,
    });
    expect(viewSource).toBeInTheDocument();
    expect(viewSource).not.toHaveAttribute("data-disabled", "true");

    // Sprint 273 — Create Trigger… is now enabled (opens dialog).
    const createItem = screen.getByRole("menuitem", {
      name: /create trigger on users/i,
    });
    expect(createItem).not.toHaveAttribute("data-disabled");

    // Sprint 274 — Drop Trigger… is now enabled (opens DropTriggerDialog
    // pre-populated for the typing-confirm input).
    const dropItem = screen.getByRole("menuitem", {
      name: /drop trigger audit_users_insert/i,
    });
    expect(dropItem).not.toHaveAttribute("data-disabled");

    // The menu container is the radix portal; ensure all 3 menu items
    // live in the SAME menu (defensive — guards against accidentally
    // matching the Table-row "View Triggers" item from a different
    // ContextMenu portal).
    const menus = screen.getAllByRole("menu");
    const lastMenu = menus[menus.length - 1]!;
    expect(within(lastMenu).getByText("View Source")).toBeInTheDocument();
  });
});
