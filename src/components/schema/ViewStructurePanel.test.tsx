import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import ViewStructurePanel from "./ViewStructurePanel";
import { useSchemaStore } from "@stores/schemaStore";
import type { ColumnInfo } from "@/types/schema";

const VIEW_COLUMNS: ColumnInfo[] = [
  {
    name: "id",
    data_type: "integer",
    nullable: false,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  },
  {
    name: "name",
    data_type: "text",
    nullable: true,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: "Display name",
  },
];

const VIEW_DEFINITION =
  "SELECT u.id, u.name FROM users u WHERE u.active = true";

describe("ViewStructurePanel", () => {
  beforeEach(() => {
    useSchemaStore.setState({
      getViewColumns: vi.fn(() => Promise.resolve(VIEW_COLUMNS)),
      getViewDefinition: vi.fn(() => Promise.resolve(VIEW_DEFINITION)),
    });
  });

  it("renders columns subtab by default with view metadata", async () => {
    await act(async () => {
      render(
        <ViewStructurePanel
          connectionId="conn1"
          schema="public"
          view="active_users"
        />,
      );
    });

    // Wait for fetch to resolve
    await waitFor(() => {
      expect(screen.getByText("id")).toBeInTheDocument();
    });

    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("integer")).toBeInTheDocument();
    expect(screen.getByText("text")).toBeInTheDocument();
    // Nullable cells render YES/NO
    expect(screen.getByText("NO")).toBeInTheDocument();
    expect(screen.getByText("YES")).toBeInTheDocument();
    expect(screen.getByText("Display name")).toBeInTheDocument();
    // Read-only badge present
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it("does not show indexes/constraints subtabs", async () => {
    await act(async () => {
      render(
        <ViewStructurePanel
          connectionId="conn1"
          schema="public"
          view="active_users"
        />,
      );
    });

    expect(screen.queryByRole("tab", { name: /indexes/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /constraints/i })).toBeNull();
    expect(screen.getByRole("tab", { name: /columns/i })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /definition/i }),
    ).toBeInTheDocument();
  });

  it("switches to definition subtab and renders SQL", async () => {
    await act(async () => {
      render(
        <ViewStructurePanel
          connectionId="conn1"
          schema="public"
          view="active_users"
        />,
      );
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: /definition/i }));
    });

    await waitFor(() => {
      expect(
        screen.getByText(/SELECT u\.id, u\.name FROM users/),
      ).toBeInTheDocument();
    });
  });

  it("renders empty-state when columns array is empty", async () => {
    useSchemaStore.setState({
      getViewColumns: vi.fn(() => Promise.resolve([])),
      getViewDefinition: vi.fn(() => Promise.resolve(VIEW_DEFINITION)),
    });

    await act(async () => {
      render(
        <ViewStructurePanel
          connectionId="conn1"
          schema="public"
          view="empty_view"
        />,
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/no columns/i)).toBeInTheDocument();
    });
  });

  it("renders fallback when definition is empty", async () => {
    useSchemaStore.setState({
      getViewColumns: vi.fn(() => Promise.resolve(VIEW_COLUMNS)),
      getViewDefinition: vi.fn(() => Promise.resolve("   ")),
    });

    await act(async () => {
      render(
        <ViewStructurePanel
          connectionId="conn1"
          schema="public"
          view="active_users"
        />,
      );
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: /definition/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/definition not available/i)).toBeInTheDocument();
    });
  });

  it("surfaces fetch errors in an alert", async () => {
    useSchemaStore.setState({
      getViewColumns: vi.fn(() => Promise.reject(new Error("View dropped"))),
      getViewDefinition: vi.fn(() => Promise.resolve(VIEW_DEFINITION)),
    });

    await act(async () => {
      render(
        <ViewStructurePanel
          connectionId="conn1"
          schema="public"
          view="active_users"
        />,
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/view dropped/i);
    });
  });

  it("renders char/line counter and Copy button on the Definition tab", async () => {
    await act(async () => {
      render(
        <ViewStructurePanel
          connectionId="conn1"
          schema="public"
          view="active_users"
        />,
      );
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: /definition/i }));
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /copy view definition/i }),
      ).toBeInTheDocument();
    });

    // VIEW_DEFINITION is a single-line string of length > 0
    const def = "SELECT u.id, u.name FROM users u WHERE u.active = true";
    expect(
      screen.getByText(`${def.length.toLocaleString()} chars · 1 line`),
    ).toBeInTheDocument();
  });

  it("does not render Copy button when definition is empty", async () => {
    useSchemaStore.setState({
      getViewColumns: vi.fn(() => Promise.resolve(VIEW_COLUMNS)),
      getViewDefinition: vi.fn(() => Promise.resolve("   ")),
    });

    await act(async () => {
      render(
        <ViewStructurePanel
          connectionId="conn1"
          schema="public"
          view="active_users"
        />,
      );
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: /definition/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/definition not available/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /copy view definition/i }),
    ).toBeNull();
  });

  it("copies the definition SQL to the clipboard and shows the Copied label", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await act(async () => {
      render(
        <ViewStructurePanel
          connectionId="conn1"
          schema="public"
          view="active_users"
        />,
      );
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: /definition/i }));
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /copy view definition/i }),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /copy view definition/i }),
      );
    });

    expect(writeText).toHaveBeenCalledWith(VIEW_DEFINITION);
    await waitFor(() => {
      expect(screen.getByText(/copied/i)).toBeInTheDocument();
    });
  });

  it("re-fetches when refresh-structure event is dispatched", async () => {
    const getViewColumns = vi.fn(() => Promise.resolve(VIEW_COLUMNS));
    useSchemaStore.setState({
      getViewColumns,
      getViewDefinition: vi.fn(() => Promise.resolve(VIEW_DEFINITION)),
    });

    await act(async () => {
      render(
        <ViewStructurePanel
          connectionId="conn1"
          schema="public"
          view="active_users"
        />,
      );
    });

    await waitFor(() => {
      expect(getViewColumns).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      window.dispatchEvent(new Event("refresh-structure"));
    });

    await waitFor(() => {
      expect(getViewColumns).toHaveBeenCalledTimes(2);
    });
  });
});
