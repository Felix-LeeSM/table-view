import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DbSwitcher from "./DbSwitcher";
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

describe("DbSwitcher", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null });
  });

  it("shows the em-dash sentinel when no tab is active", () => {
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database \(read-only\)/i,
    });
    expect(trigger.textContent).toMatch(/—/);
  });

  it("is aria-disabled and not in the keyboard tab order", () => {
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database \(read-only\)/i,
    });
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).toHaveAttribute("tabindex", "-1");
  });

  it("exposes the S128 tooltip text via title", () => {
    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database \(read-only\)/i,
    });
    expect(trigger).toHaveAttribute(
      "title",
      "Switching DBs is coming in sprint 128",
    );
  });

  it("shows the document-paradigm tab's database name", () => {
    const tab = makeQueryTab({
      paradigm: "document",
      queryMode: "find",
      database: "analytics",
      collection: "events",
    });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database \(read-only\)/i,
    });
    expect(trigger.textContent).toMatch(/analytics/);
  });

  it("shows the rdb tab's schema as a placeholder until S128", () => {
    const tab = makeTableTab({ schema: "warehouse" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database \(read-only\)/i,
    });
    expect(trigger.textContent).toMatch(/warehouse/);
  });

  it("shows the (default) sentinel when an active tab has no schema/database", () => {
    const tab = makeQueryTab({ paradigm: "rdb" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database \(read-only\)/i,
    });
    expect(trigger.textContent).toMatch(/\(default\)/);
  });

  it("does not invoke any tab store action when clicked (read-only)", () => {
    const tab = makeTableTab({ schema: "public" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<DbSwitcher />);
    const trigger = screen.getByRole("button", {
      name: /active database \(read-only\)/i,
    });
    const before = JSON.stringify(useTabStore.getState());
    fireEvent.click(trigger);
    const after = JSON.stringify(useTabStore.getState());
    expect(after).toBe(before);
  });
});
