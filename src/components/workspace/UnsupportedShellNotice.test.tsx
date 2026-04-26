import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import UnsupportedShellNotice from "./UnsupportedShellNotice";

describe("UnsupportedShellNotice", () => {
  it("renders kv placeholder copy and aria-label", () => {
    render(<UnsupportedShellNotice paradigm="kv" />);
    const status = screen.getByRole("status", {
      name: /key-value workspace placeholder/i,
    });
    expect(status).toBeInTheDocument();
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        /key-value database support is planned but not yet implemented/i,
      ),
    ).toBeInTheDocument();
  });

  it("renders search placeholder copy and aria-label", () => {
    render(<UnsupportedShellNotice paradigm="search" />);
    const status = screen.getByRole("status", {
      name: /search workspace placeholder/i,
    });
    expect(status).toBeInTheDocument();
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        /search database support is planned but not yet implemented/i,
      ),
    ).toBeInTheDocument();
  });
});
