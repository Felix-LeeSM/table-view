// Issue #1058 — loading-state convention. Guards the a11y contract the former
// bare-`Loader2` initial-load blocks lacked: the shared tree/sidebar skeleton
// exposes a labelled `role="status"` region and renders `animate-pulse`
// placeholder bars (never a spinner).
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TreeSkeleton from "./TreeSkeleton";

describe("TreeSkeleton", () => {
  it("renders a labelled status region with skeleton bars, no spinner", () => {
    const { container } = render(<TreeSkeleton />);

    const region = screen.getByRole("status", { name: "Loading" });
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      0,
    );
    expect(container.querySelector(".animate-spin")).toBeNull();
  });
});
