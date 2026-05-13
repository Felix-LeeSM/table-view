import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./skeleton";

// Sprint 270 (2026-05-13)
// Locks the shadcn/ui canonical class composition of the Skeleton primitive.
// Sidebar + main-area pre-hydrate branches both depend on this exact set —
// if someone drops `animate-pulse` (no shimmer) or `bg-muted` (wrong color
// in dark mode) the visual contract silently breaks. AC-270-01 / AC-270-02
// rely on this primitive being stable.
describe("Skeleton (shadcn primitive)", () => {
  it("renders a div with animate-pulse, rounded-md, bg-muted by default", () => {
    const { container } = render(<Skeleton data-testid="sk" />);
    const el = container.querySelector("[data-testid='sk']");
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(HTMLDivElement);
    expect(el!.className).toContain("animate-pulse");
    expect(el!.className).toContain("rounded-md");
    expect(el!.className).toContain("bg-muted");
  });

  it("merges a caller-supplied className with the defaults", () => {
    const { container } = render(
      <Skeleton data-testid="sk" className="h-8 w-full" />,
    );
    const el = container.querySelector("[data-testid='sk']")!;
    expect(el.className).toContain("animate-pulse");
    expect(el.className).toContain("h-8");
    expect(el.className).toContain("w-full");
  });

  it("forwards arbitrary HTMLDivElement attributes (role, aria-*)", () => {
    const { container } = render(
      <Skeleton
        data-testid="sk"
        role="status"
        aria-busy="true"
        aria-label="Loading"
      />,
    );
    const el = container.querySelector("[data-testid='sk']")!;
    expect(el.getAttribute("role")).toBe("status");
    expect(el.getAttribute("aria-busy")).toBe("true");
    expect(el.getAttribute("aria-label")).toBe("Loading");
  });
});
