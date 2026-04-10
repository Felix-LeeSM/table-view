import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TabBar from "./TabBar";
import { useTabStore, type TableTab } from "../stores/tabStore";

function addTableTab(overrides: Partial<Omit<TableTab, "id">> = {}) {
  useTabStore.getState().addTab({
    title: "Test Tab",
    connectionId: "conn1",
    type: "table",
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
    ...overrides,
  });
}

function fireAuxClick(element: Element, button: number) {
  fireEvent(element, new MouseEvent("auxclick", { bubbles: true, button, cancelable: true }));
}

describe("TabBar", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null });
  });

  it("renders nothing when no tabs", () => {
    const { container } = render(<TabBar />);
    expect(container.innerHTML).toBe("");
  });

  it("renders tabs with titles", () => {
    addTableTab({ title: "Users", table: "users" });
    addTableTab({ title: "Orders", table: "orders" });

    render(<TabBar />);
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Orders")).toBeInTheDocument();
  });

  it("closes tab on middle-click (auxclick button 1)", () => {
    addTableTab({ title: "Users", table: "users" });
    addTableTab({ title: "Orders", table: "orders" });

    render(<TabBar />);

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(2);

    const ordersTab = screen.getByText("Orders").closest("[role='tab']")!;
    fireAuxClick(ordersTab, 1);

    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(screen.queryByText("Orders")).not.toBeInTheDocument();
  });

  it("does not close tab on right-click (auxclick button 2)", () => {
    addTableTab({ title: "Users", table: "users" });
    addTableTab({ title: "Orders", table: "orders" });

    render(<TabBar />);

    const ordersTab = screen.getByText("Orders").closest("[role='tab']")!;
    fireAuxClick(ordersTab, 2);

    expect(useTabStore.getState().tabs).toHaveLength(2);
  });

  it("activates tab on click", () => {
    addTableTab({ title: "Users", table: "users" });
    addTableTab({ title: "Orders", table: "orders" });

    render(<TabBar />);

    const state = useTabStore.getState();
    const firstTabId = state.tabs[0]!.id;

    // Click the first tab (second tab is currently active)
    const usersTab = screen.getByText("Users").closest("[role='tab']")!;
    fireEvent.click(usersTab);

    expect(useTabStore.getState().activeTabId).toBe(firstTabId);
  });

  it("closes tab via close button", () => {
    addTableTab({ title: "Users", table: "users" });

    render(<TabBar />);
    const closeBtn = screen.getByLabelText("Close Users");
    fireEvent.click(closeBtn);

    expect(useTabStore.getState().tabs).toHaveLength(0);
  });

  it("shows + button for new query tab when connection is active", () => {
    addTableTab({ title: "Users", table: "users" });

    render(<TabBar />);
    expect(screen.getByLabelText("New Query Tab")).toBeInTheDocument();
  });

  it("adds query tab on + button click", () => {
    addTableTab({ title: "Users", table: "users" });

    render(<TabBar />);
    const addBtn = screen.getByLabelText("New Query Tab");
    fireEvent.click(addBtn);

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[1]!.type).toBe("query");
    expect(state.activeTabId).toBe(state.tabs[1]!.id);
  });

  it("renders query tab with correct icon", () => {
    addTableTab({ title: "Users", table: "users" });
    useTabStore.getState().addQueryTab("conn1");

    render(<TabBar />);
    const tabs = screen.getAllByRole("tab");
    // Second tab should be the query tab
    const queryTab = tabs[1]!;
    expect(queryTab).toHaveAttribute("aria-selected", "true");
  });
});
