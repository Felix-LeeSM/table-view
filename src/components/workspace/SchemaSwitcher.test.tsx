import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SchemaSwitcher from "./SchemaSwitcher";
import { useTabStore, type TableTab, type QueryTab } from "@stores/tabStore";

function makeTableTab(overrides: Partial<TableTab> = {}): TableTab {
  return {
    type: "table",
    id: "tab-1",
    title: "users",
    connectionId: "c1",
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
    ...overrides,
  };
}

function makeQueryTab(overrides: Partial<QueryTab> = {}): QueryTab {
  return {
    type: "query",
    id: "query-1",
    title: "Query 1",
    connectionId: "c1",
    closable: true,
    sql: "",
    queryState: { status: "idle" },
    paradigm: "rdb",
    queryMode: "sql",
    ...overrides,
  };
}

describe("SchemaSwitcher", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null });
  });

  it("shows the em-dash sentinel when no tab is active", () => {
    render(<SchemaSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active schema \(read-only\)/i,
    });
    expect(trigger.textContent).toMatch(/—/);
  });

  it("is aria-disabled and not in the keyboard tab order", () => {
    render(<SchemaSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active schema \(read-only\)/i,
    });
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).toHaveAttribute("tabindex", "-1");
  });

  it("shows the active rdb tab's schema name", () => {
    const tab = makeTableTab({ schema: "analytics" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<SchemaSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active schema \(read-only\)/i,
    });
    expect(trigger.textContent).toMatch(/analytics/);
  });

  it("shows the document tab's collection as a placeholder", () => {
    const tab = makeQueryTab({
      paradigm: "document",
      queryMode: "find",
      database: "db1",
      collection: "users",
    });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<SchemaSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active schema \(read-only\)/i,
    });
    expect(trigger.textContent).toMatch(/users/);
  });

  it("shows (default) when the active tab carries no schema", () => {
    const tab = makeQueryTab({ paradigm: "rdb" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<SchemaSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active schema \(read-only\)/i,
    });
    expect(trigger.textContent).toMatch(/\(default\)/);
  });

  it("exposes the tooltip text via title", () => {
    render(<SchemaSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active schema \(read-only\)/i,
    });
    expect(trigger.getAttribute("title") ?? "").toMatch(/sprint 128/i);
  });

  it("is read-only — clicking does not mutate the tab store", () => {
    const tab = makeTableTab({ schema: "public" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<SchemaSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active schema \(read-only\)/i,
    });
    const before = JSON.stringify(useTabStore.getState());
    fireEvent.click(trigger);
    const after = JSON.stringify(useTabStore.getState());
    expect(after).toBe(before);
  });
});
