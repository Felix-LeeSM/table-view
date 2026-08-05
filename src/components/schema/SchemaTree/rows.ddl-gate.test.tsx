// Issue #2173 (follow-up to PR #2148) — the DDL affordances this module renders
// are gated by booleans on `SchemaTreeRowsContext`, not by the capability table
// directly: `SchemaTree.tsx` resolves `supportsDdl(dbType, …)` once and passes
// the results down. This file covers every such prop. The census that defines
// "every" is a command, not a list kept in someone's head:
//
//   grep -oE "ctx\.can[A-Za-z]+" src/components/schema/SchemaTree/rows.tsx \
//     | sort | uniq -c
//
// At 4398ae53 that prints three props over five gate sites — `canAlterTable`
// (the F2 rename shortcut + the context-menu Rename item), `canCreateTable`
// (the schema-row Create Table entry + the Tables category `+` button) and
// `canDropObject` (the context-menu Drop item). Adding a fourth prop without a
// case here makes the census and this file disagree.
//
// The negative half of these locks used to be written as "pick an engine whose
// profile has the capability off". That is no longer constructible. At
// 4398ae53:
//
//   git grep -nE "(alterTable|createTable): false" -- src/types/dataSource.ts
//
// returns two adjacent hits and both sit in the same capability-absent default
// block, where `createIndex` / `dropObject` are false too — not a named engine
// profile. So no shipped RDB profile turns one DDL gate off, and a
// capability-driven negative test goes quietly vacuous the moment an engine
// flips a flag. #1804 (SQLite native DDL) is exactly that happening.
//
// Pinning the negative case on the prop instead survives any capability-table
// edit. Every case below uses `dbType: "postgresql"`, whose profile has
// `createTable` / `alterTable` / `dropObject` all true
// (`POSTGRESQL_CAPABILITIES` in `src/types/dataSource.ts`) — so the capability
// table cannot be what closes a gate here, only the prop can.
//
// Two structural rules keep these cases from going vacuous themselves:
//   - Every negative assertion has a paired positive in the SAME render. If the
//     row never rendered, or a Radix menu never opened, the positive fails
//     first instead of the negative passing on an empty DOM.
//   - Where two gates sit on one surface, the negative case leaves the other
//     flag true, so a mis-wire (one gate reading the other's flag) fails here.
//
// The user-facing end of the positive paths — F2 mounting RenameTableDialog,
// `+` opening CreateTableDialog — stays locked by
// `SchemaTree.actions.test.tsx`; this file locks the gates.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TableInfo } from "@/types/schema";
import {
  renderCategoryRow,
  renderItemRow,
  renderSchemaRow,
  type SchemaTreeRowsContext,
} from "./rows";
import { CATEGORIES, type Category, type VisibleRow } from "./treeRows";

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

const SCHEMA_ROW: Extract<VisibleRow, { kind: "schema" }> = {
  kind: "schema",
  key: "schema:public",
  schemaName: "public",
  isExpanded: true,
  isLoadingTables: false,
  isSelected: false,
  tableCount: 3,
};

// The `+` gate is `isTables && ctx.canCreateTable`, so reuse the real
// descriptor: a renamed category key must fail here, not silently test the
// wrong category.
function tablesCategory(): Category {
  const cat = CATEGORIES.find((c) => c.key === "tables");
  if (!cat) throw new Error("CATEGORIES no longer has a `tables` entry");
  return cat;
}

const CATEGORY_ROW: Extract<VisibleRow, { kind: "category" }> = {
  kind: "category",
  key: "category:public:tables",
  schemaName: "public",
  category: tablesCategory(),
  isExpanded: true,
  isSelected: false,
  // Rendered as a badge in the same container div as the `+` button — the
  // paired positive for the `+` cases below.
  itemCount: 7,
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

async function openMenu(trigger: HTMLElement) {
  await act(async () => {
    fireEvent.contextMenu(trigger, { clientX: 100, clientY: 200 });
  });
}

async function openContextMenu(ctx: SchemaTreeRowsContext) {
  await openMenu(renderRow(ctx));
}

describe("SchemaTree rows — DDL gates read props, not capabilities (#2173)", () => {
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

  // `canCreateTable` — the third prop in the census. Unlike the pair above it
  // feeds two different surfaces, so each gets its own pair of cases.

  it("drops the schema-row Create Table entry when canCreateTable is false", async () => {
    render(renderSchemaRow(SCHEMA_ROW, makeCtx({ canCreateTable: false })));
    await openMenu(screen.getByLabelText("public schema"));

    expect(screen.queryByText("createTableMenu")).not.toBeInTheDocument();
    // Ungated sibling entry in the same menu: if Radix never opened it, this
    // fails instead of the negative above passing on an empty DOM.
    expect(screen.getByText("refresh")).toBeInTheDocument();
  });

  it("keeps the schema-row Create Table entry when canCreateTable is true", async () => {
    render(renderSchemaRow(SCHEMA_ROW, makeCtx()));
    await openMenu(screen.getByLabelText("public schema"));

    expect(screen.getByText("createTableMenu")).toBeInTheDocument();
    expect(screen.getByText("refresh")).toBeInTheDocument();
  });

  it("drops the Tables category + button when canCreateTable is false", () => {
    render(renderCategoryRow(CATEGORY_ROW, makeCtx({ canCreateTable: false })));

    expect(
      screen.queryByLabelText("createTableInAria"),
    ).not.toBeInTheDocument();
    // Badge sibling inside the same container div as the `+` button.
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("keeps the Tables category + button when canCreateTable is true", () => {
    render(renderCategoryRow(CATEGORY_ROW, makeCtx()));

    expect(screen.getByLabelText("createTableInAria")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });
});
