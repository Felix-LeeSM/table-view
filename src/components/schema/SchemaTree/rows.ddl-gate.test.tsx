// Issue #2173 (follow-up to PR #2148) — the table-row DDL affordances in
// `renderItemRow` (context-menu Rename / Drop, and the F2 rename shortcut) are
// gated by two booleans on `SchemaTreeRowsContext`, not by the capability table
// directly: `SchemaTree.tsx` resolves `supportsDdl(dbType, "alterTable")` /
// `supportsDdl(dbType, "dropObject")` once and passes the results down as
// `ctx.canAlterTable` / `ctx.canDropObject`.
//
// The negative half of that lock used to be written as "pick an engine whose
// profile has the capability off". That is no longer constructible. At
// 4398ae53:
//
//   git grep -nE "alterTable: false" -- src/types/dataSource.ts
//
// returns a single hit, and it sits in the capability-absent default block
// where `createTable` / `createIndex` / `dropObject` are false too — not a
// named engine profile. So no shipped RDB profile turns one DDL gate off, and
// a capability-driven negative test goes quietly vacuous the moment an engine
// flips a flag. #1804 (SQLite native DDL) is exactly that happening.
//
// Pinning the negative case on the prop instead survives any capability-table
// edit. Every case below uses `dbType: "postgresql"`, whose profile has
// `alterTable: true` and `dropObject: true` (`POSTGRESQL_CAPABILITIES` in
// `src/types/dataSource.ts`) — so the capability table cannot be what closes a
// gate here, only the prop can.
//
// Each negative case leaves the *other* flag true and asserts its affordance is
// still there, so a mis-wire (one gate reading the other's flag) fails here.
// The user-facing end of the positive path — F2 mounting RenameTableDialog —
// stays locked by `SchemaTree.actions.test.tsx`; this file locks the gates.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TableInfo } from "@/types/schema";
import { renderItemRow, type SchemaTreeRowsContext } from "./rows";
import type { VisibleRow } from "./treeRows";

const TABLE: TableInfo = { name: "users", schema: "public", row_count: null };

const ROW: Extract<VisibleRow, { kind: "item" }> = {
  kind: "item",
  key: "tables:public:users",
  schemaName: "public",
  categoryKey: "tables",
  item: TABLE,
  itemKind: "table",
  isSelected: false,
  isActive: false,
};

// `t` is the identity so the assertions read the i18n *key*, not a translation:
// this file is about which entries render, not about their wording.
function makeCtx(
  overrides: Partial<SchemaTreeRowsContext> = {},
): SchemaTreeRowsContext {
  return {
    t: (key) => key,
    dbType: "postgresql",
    canCreateTable: true,
    canAlterTable: true,
    canDropObject: true,
    rovingFocusKey: ROW.key,
    onFocusRow: vi.fn(),
    treeShape: "with-schema",
    globalFilterActive: false,
    toggleCategory: vi.fn(),
    setSelectedNodeId: vi.fn(),
    setTableSearch: vi.fn(),
    isCategoryExpanded: () => true,
    handleExpandSchema: vi.fn(async () => {}),
    handleRefreshSchema: vi.fn(),
    handleTableClick: vi.fn(),
    handleTableDoubleClick: vi.fn(),
    handleOpenStructure: vi.fn(),
    handleDropTable: vi.fn(),
    handleStartRename: vi.fn(),
    handleImportCsv: vi.fn(),
    handleTogglePin: vi.fn(),
    isTablePinned: () => false,
    handleViewClick: vi.fn(),
    handleOpenViewStructure: vi.fn(),
    handleFunctionClick: vi.fn(),
    handleCreateTable: vi.fn(),
    handleExportSchema: vi.fn(),
    handleExportTable: vi.fn(),
    ...overrides,
  };
}

function renderRow(ctx: SchemaTreeRowsContext) {
  render(renderItemRow(ROW, ctx));
  return screen.getByLabelText("users table");
}

async function openContextMenu(ctx: SchemaTreeRowsContext) {
  const rowButton = renderRow(ctx);
  await act(async () => {
    fireEvent.contextMenu(rowButton, { clientX: 100, clientY: 200 });
  });
}

describe("SchemaTree item row — DDL gates read props, not capabilities (#2173)", () => {
  it("drops the Rename menu item when canAlterTable is false and keeps Drop", async () => {
    await openContextMenu(makeCtx({ canAlterTable: false }));

    expect(screen.queryByText("rename")).not.toBeInTheDocument();
    // canDropObject is still true — the Drop entry must not ride the other flag.
    expect(screen.getByText("drop")).toBeInTheDocument();
  });

  it("drops the Drop menu item when canDropObject is false and keeps Rename", async () => {
    await openContextMenu(makeCtx({ canDropObject: false }));

    expect(screen.queryByText("drop")).not.toBeInTheDocument();
    expect(screen.getByText("rename")).toBeInTheDocument();
  });

  it("ignores F2 on a table row when canAlterTable is false", async () => {
    const ctx = makeCtx({ canAlterTable: false });
    const rowButton = renderRow(ctx);

    await act(async () => {
      fireEvent.keyDown(rowButton, { key: "F2" });
    });

    expect(ctx.handleStartRename).not.toHaveBeenCalled();
  });

  it("starts rename on F2 when canAlterTable is true", async () => {
    const ctx = makeCtx();
    const rowButton = renderRow(ctx);

    await act(async () => {
      fireEvent.keyDown(rowButton, { key: "F2" });
    });

    expect(ctx.handleStartRename).toHaveBeenCalledWith("users", "public");
  });
});
