import { CONNECTION_COLOR_PALETTE } from "@lib/connectionColor";
import { useConnectionStore } from "@stores/connectionStore";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig, ConnectionGroup } from "@/types/connection";
import GroupDialog from "./GroupDialog";

const mockAddGroup = vi.fn();
const mockUpdateGroup = vi.fn();

function setStoreState(connections: ConnectionConfig[] = []) {
  useConnectionStore.setState({
    connections,
    addGroup: mockAddGroup.mockResolvedValue({
      id: "new-gid",
      name: "stub",
      color: null,
      collapsed: false,
    }),
    updateGroup: mockUpdateGroup.mockResolvedValue(undefined),
  } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);
}

function makeConnection(
  overrides: Partial<ConnectionConfig> = {},
): ConnectionConfig {
  return {
    id: "conn-1",
    name: "Test DB",
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    hasPassword: false,
    database: "testdb",
    groupId: null,
    color: null,
    paradigm: "rdb",
    ...overrides,
  };
}

describe("GroupDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState();
  });

  it("renders New Group title when creating", () => {
    render(<GroupDialog onClose={() => {}} />);
    expect(
      screen.getByRole("dialog", { name: /new group/i }),
    ).toBeInTheDocument();
  });

  it("renders Edit Group title when a group is supplied", () => {
    const group: ConnectionGroup = {
      id: "g1",
      name: "Prod",
      color: CONNECTION_COLOR_PALETTE[0]!,
      collapsed: false,
    };
    render(<GroupDialog group={group} onClose={() => {}} />);
    expect(
      screen.getByRole("dialog", { name: /edit group/i }),
    ).toBeInTheDocument();
  });

  it("exposes a palette of 10 color swatches + a 'No color' radio", () => {
    render(<GroupDialog onClose={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: /group color/i });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(CONNECTION_COLOR_PALETTE.length + 1);
    expect(
      screen.getByRole("radio", { name: /no color/i }),
    ).toBeInTheDocument();
  });

  it("[group-dialog] radiogroup: single tab stop on the checked radio, arrows move + select", async () => {
    const user = userEvent.setup();
    render(<GroupDialog onClose={() => {}} />);
    const radios = screen.getAllByRole("radio");
    // Default new group is "No color" (index 0) — the only tab stop.
    expect(radios[0]).toHaveAttribute("tabindex", "0");
    expect(radios[1]).toHaveAttribute("tabindex", "-1");

    // Focus the checked radio, then ArrowRight selects + focuses the next.
    radios[0]!.focus();
    await user.keyboard("{ArrowRight}");
    expect(radios[1]).toHaveFocus();
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
    expect(radios[1]).toHaveAttribute("tabindex", "0");
    expect(radios[0]).toHaveAttribute("aria-checked", "false");
    expect(radios[0]).toHaveAttribute("tabindex", "-1");

    // ArrowLeft wraps back to "No color".
    await user.keyboard("{ArrowLeft}");
    expect(radios[0]).toHaveFocus();
    expect(radios[0]).toHaveAttribute("aria-checked", "true");

    // ArrowLeft from index 0 wraps to the last swatch.
    await user.keyboard("{ArrowLeft}");
    expect(radios[radios.length - 1]).toHaveFocus();
    expect(radios[radios.length - 1]).toHaveAttribute("aria-checked", "true");
  });

  // -------------------------------------------------------------------------
  // #2439 — result preview inside the dialog
  // -------------------------------------------------------------------------

  it("[group-dialog] preview swatch takes the color picked from the palette", () => {
    render(<GroupDialog onClose={() => {}} />);
    // A new group starts on "No color", so the dot carries no inline fill.
    expect(
      screen.getByTestId("group-preview-color-accent").getAttribute("style"),
    ).toBeFalsy();

    act(() => {
      fireEvent.click(
        screen.getByRole("radio", {
          name: `Color ${CONNECTION_COLOR_PALETTE[2]}`,
        }),
      );
    });

    expect(screen.getByTestId("group-preview-color-accent")).toHaveStyle({
      backgroundColor: CONNECTION_COLOR_PALETTE[2],
    });
  });

  it("[group-dialog] preview shows the bordered placeholder dot for 'No color'", () => {
    render(<GroupDialog onClose={() => {}} />);
    act(() => {
      fireEvent.click(
        screen.getByRole("radio", {
          name: `Color ${CONNECTION_COLOR_PALETTE[0]}`,
        }),
      );
    });
    expect(
      screen.getByTestId("group-preview-color-accent").getAttribute("style"),
    ).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: /no color/i }));
    });

    // Same shape the list header uses for a color=null group: bordered, no fill.
    const dot = screen.getByTestId("group-preview-color-accent");
    expect(dot.getAttribute("style")).toBeFalsy();
    expect(dot.className).toContain("border-border");
    expect(dot.className).toContain("bg-transparent");
  });

  it("[group-dialog] preview mirrors the typed name and the group's connection count", () => {
    setStoreState([
      makeConnection({ id: "c1", groupId: "g1" }),
      makeConnection({ id: "c2", groupId: "g1" }),
      makeConnection({ id: "c3", groupId: "g2" }),
    ]);
    const group: ConnectionGroup = {
      id: "g1",
      name: "Prod",
      color: null,
      collapsed: false,
    };
    render(<GroupDialog group={group} onClose={() => {}} />);

    const preview = screen.getByTestId("group-dialog-preview");
    expect(preview).toHaveTextContent("Prod");
    expect(preview).toHaveTextContent("(2)");

    act(() => {
      fireEvent.change(screen.getByLabelText(/name/i), {
        target: { value: "Staging" },
      });
    });
    expect(preview).toHaveTextContent("Staging");

    // Blank name falls back to a placeholder instead of an empty row.
    act(() => {
      fireEvent.change(screen.getByLabelText(/name/i), {
        target: { value: "" },
      });
    });
    expect(preview).toHaveTextContent(/untitled group/i);
  });

  it("disables the Create button when the name is blank", () => {
    render(<GroupDialog onClose={() => {}} />);
    const createBtn = screen.getByRole("button", { name: /create group/i });
    expect(createBtn).toBeDisabled();
  });

  it("calls addGroup with name and selected color on submit", async () => {
    const onClose = vi.fn();
    render(<GroupDialog onClose={onClose} />);

    const name = screen.getByLabelText(/name/i);
    act(() => {
      fireEvent.change(name, { target: { value: "  Staging  " } });
    });

    const swatch = screen.getByRole("radio", {
      name: `Color ${CONNECTION_COLOR_PALETTE[2]}`,
    });
    act(() => {
      fireEvent.click(swatch);
    });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /create group/i }));
    });

    await waitFor(() => {
      expect(mockAddGroup).toHaveBeenCalledWith({
        id: "",
        name: "Staging",
        color: CONNECTION_COLOR_PALETTE[2],
        collapsed: false,
      });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("submits with null color when 'No color' is selected", async () => {
    render(<GroupDialog onClose={() => {}} />);
    act(() => {
      fireEvent.change(screen.getByLabelText(/name/i), {
        target: { value: "Misc" },
      });
    });
    // "No color" is selected by default for a new group — just submit.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /create group/i }));
    });

    await waitFor(() => {
      expect(mockAddGroup).toHaveBeenCalledWith(
        expect.objectContaining({ color: null }),
      );
    });
  });

  it("calls updateGroup when editing an existing group", async () => {
    const group: ConnectionGroup = {
      id: "g1",
      name: "Prod",
      color: null,
      collapsed: false,
    };
    render(<GroupDialog group={group} onClose={() => {}} />);

    // Change the color
    const swatch = screen.getByRole("radio", {
      name: `Color ${CONNECTION_COLOR_PALETTE[5]}`,
    });
    act(() => {
      fireEvent.click(swatch);
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
    });

    await waitFor(() => {
      expect(mockUpdateGroup).toHaveBeenCalledWith({
        id: "g1",
        name: "Prod",
        color: CONNECTION_COLOR_PALETTE[5],
        collapsed: false,
      });
    });
  });

  it("submits on Enter key inside the name input", async () => {
    render(<GroupDialog onClose={() => {}} />);
    const name = screen.getByLabelText(/name/i);
    act(() => {
      fireEvent.change(name, { target: { value: "Staging" } });
    });
    act(() => {
      fireEvent.keyDown(name, { key: "Enter" });
    });
    await waitFor(() => {
      expect(mockAddGroup).toHaveBeenCalled();
    });
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(<GroupDialog onClose={onClose} />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    });
    expect(onClose).toHaveBeenCalled();
    expect(mockAddGroup).not.toHaveBeenCalled();
  });
});
