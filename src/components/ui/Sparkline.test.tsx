// #1077 admin-parity Stage 3 (2026-07-25) — Sparkline renders a trend
// polyline only once there are >= 2 samples.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("renders nothing with fewer than two samples", () => {
    const { container } = render(
      <Sparkline data={[5]} ariaLabel="trend" data-testid="spark" />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("draws a polyline through the samples once there are two or more", () => {
    render(
      <Sparkline data={[1, 3, 2, 4]} ariaLabel="trend" data-testid="spark" />,
    );
    const svg = screen.getByTestId("spark");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAccessibleName("trend");
    const polyline = svg.querySelector("polyline");
    expect(polyline).not.toBeNull();
    // 4 samples → 4 "x,y" point pairs.
    expect(polyline?.getAttribute("points")?.trim().split(/\s+/)).toHaveLength(
      4,
    );
  });

  it("draws a flat line without dividing by zero when all samples are equal", () => {
    render(
      <Sparkline data={[7, 7, 7]} ariaLabel="trend" data-testid="spark" />,
    );
    const points = screen
      .getByTestId("spark")
      .querySelector("polyline")
      ?.getAttribute("points");
    // span falls back to 1, so every y is finite (no NaN from 0/0).
    expect(points).not.toMatch(/NaN/);
  });
});
