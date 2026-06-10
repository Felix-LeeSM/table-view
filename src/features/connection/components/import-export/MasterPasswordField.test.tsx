import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import MasterPasswordField from "./MasterPasswordField";

function Wrapper({
  initial = "",
  minLength,
  label,
}: {
  initial?: string;
  minLength?: number;
  label?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MasterPasswordField
      value={value}
      onChange={setValue}
      label={label}
      minLength={minLength}
    />
  );
}

describe("MasterPasswordField", () => {
  it("renders the label", () => {
    render(<Wrapper label="Master password" />);
    expect(screen.getByLabelText(/^master password$/i)).toBeInTheDocument();
  });

  it("calls onChange when the user types", () => {
    const onChange = vi.fn();
    render(<MasterPasswordField value="" onChange={onChange} />);
    const input = screen.getByLabelText(/^master password$/i);
    fireEvent.change(input, { target: { value: "abc" } });
    expect(onChange).toHaveBeenCalledWith("abc");
  });

  it("toggles between password and text input via the show/hide button", () => {
    render(<Wrapper initial="secret" />);
    const input = screen.getByLabelText(
      /^master password$/i,
    ) as HTMLInputElement;
    expect(input.type).toBe("password");

    const toggle = screen.getByRole("button", {
      name: /show master password/i,
    });
    act(() => {
      fireEvent.click(toggle);
    });
    expect(input.type).toBe("text");
    expect(
      screen.getByRole("button", { name: /hide master password/i }),
    ).toBeInTheDocument();

    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /hide master password/i }),
      );
    });
    expect(input.type).toBe("password");
  });

  it("shows inline error when length is below minLength (default 8)", () => {
    render(<Wrapper initial="abc" />);
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it("hides inline error when value reaches minLength", () => {
    render(<Wrapper initial="abcdefgh" />);
    expect(screen.queryByText(/at least 8 characters/i)).toBeNull();
  });

  it("does not show inline error for empty input (caller decides 'required')", () => {
    render(<Wrapper initial="" />);
    expect(screen.queryByText(/at least 8 characters/i)).toBeNull();
  });

  it("respects custom minLength override", () => {
    render(<Wrapper initial="abc" minLength={4} />);
    // 3 chars < 4 → shows error mentioning "at least 4 characters"
    expect(screen.getByText(/at least 4 characters/i)).toBeInTheDocument();
  });

  it("flags input as aria-invalid when below minLength", () => {
    render(<Wrapper initial="ab" />);
    const input = screen.getByLabelText(/^master password$/i);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});
