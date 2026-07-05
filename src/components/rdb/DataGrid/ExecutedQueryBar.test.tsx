import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExecutedQueryBar } from "./ExecutedQueryBar";

// #1339 follow-up — while collapsed the toggle kept `aria-controls` pointing at
// the query region id, but that region is unmounted when collapsed, leaving a
// dangling reference that assistive tech cannot resolve.
describe("ExecutedQueryBar aria-controls (#1339)", () => {
  it("references the region only while it is mounted (no dangling id when collapsed)", () => {
    render(<ExecutedQueryBar sql="SELECT 1" />);
    const toggle = screen.getByRole("button");

    // Expanded by default: the region exists and aria-controls resolves to it.
    const expanded = toggle.getAttribute("aria-controls");
    expect(expanded).toBeTruthy();
    expect(document.getElementById(expanded!)).not.toBeNull();

    // Collapse: the region unmounts, so aria-controls must not dangle.
    fireEvent.click(toggle);
    const collapsed = toggle.getAttribute("aria-controls");
    expect(
      collapsed === null || document.getElementById(collapsed) !== null,
    ).toBe(true);
  });
});
