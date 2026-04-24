import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import GroupDialog from "./GroupDialog";
import { useConnectionStore } from "@stores/connectionStore";
import { CONNECTION_COLOR_PALETTE } from "@lib/connectionColor";
import type { ConnectionGroup } from "@/types/connection";

const mockAddGroup = vi.fn();
const mockUpdateGroup = vi.fn();

function setStoreState() {
  useConnectionStore.setState({
    addGroup: mockAddGroup.mockResolvedValue({
      id: "new-gid",
      name: "stub",
      color: null,
      collapsed: false,
    }),
    updateGroup: mockUpdateGroup.mockResolvedValue(undefined),
  } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);
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
