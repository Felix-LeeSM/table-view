// Sprint 310 (2026-05-14) — Phase 28 Slice A4: toolbar `+ Insert ▾`
// visibility regression test. AC-01: button exists on document-paradigm
// tabs and is absent on RDB tabs.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Stub the heavy `FavoritesPanel` import so the Toolbar can mount in
// isolation without dragging in the favorites store. The save form +
// favorites popover are not under test here.
vi.mock("../FavoritesPanel", () => ({
  default: () => <div data-testid="favorites-panel-stub" />,
}));

import QueryTabToolbar, { type QueryTabToolbarProps } from "./Toolbar";
import type { QueryTab } from "@stores/workspaceStore";
import type { EditorView } from "@codemirror/view";

function makeTab(paradigm: "rdb" | "document"): QueryTab {
  return {
    type: "query",
    id: "tab-1",
    title: "untitled",
    connectionId: "conn-1",
    closable: true,
    sql: "SELECT 1",
    queryState: { status: "idle" },
    paradigm,
    database: "test",
  };
}

function renderToolbar(
  paradigm: "rdb" | "document",
  overrides: Partial<QueryTabToolbarProps> = {},
) {
  const editorRef: React.RefObject<EditorView | null> = { current: null };
  const props: QueryTabToolbarProps = {
    tab: makeTab(paradigm),
    isDocument: paradigm === "document",
    onExecute: vi.fn(),
    onDryRun: vi.fn(),
    onFormat: vi.fn(),
    favorites: {
      showSaveForm: false,
      setShowSaveForm: vi.fn(),
      favoriteName: "",
      setFavoriteName: vi.fn(),
      showFavorites: false,
      setShowFavorites: vi.fn(),
      favorites: [],
      handleSaveFavorite: vi.fn(),
      handleLoadFavoriteSql: vi.fn(),
    },
    editorRef,
    ...overrides,
  };
  return render(<QueryTabToolbar {...props} />);
}

describe("QueryTabToolbar — `+ Insert ▾` snippet menu visibility (AC-01)", () => {
  it("renders the snippet button on a document-paradigm tab", () => {
    renderToolbar("document");
    expect(
      screen.getByRole("button", { name: /insert mongosh snippet/i }),
    ).toBeInTheDocument();
  });

  it("does NOT render the snippet button on a RDB-paradigm tab", () => {
    renderToolbar("rdb");
    expect(
      screen.queryByRole("button", { name: /insert mongosh snippet/i }),
    ).toBeNull();
  });
});
