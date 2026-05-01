// AC-185-03 — SafeModeToggle component tests. 3 cases per Sprint 185 contract.
// AC-186-02 — Sprint 186 adds warn-mode visual + 3-way cycle.
// Post-Sprint-187 hotfix (HF-187-A) — verbose per-mode help is delivered via
// the native `title` tooltip (same surface as DisconnectButton /
// HistoryButton) for affordance uniformity. An earlier HoverCard prototype
// was reverted after the user pointed out it fired alongside the `title`
// attribute and an Info-icon variant would have collided with the parent
// button's tooltip on hover. One new case pins the per-mode title content
// (Strict / Warn / Off heading + canonical danger statement examples for
// strict + non-production scoping note) so the help text stays in sync with
// the contract. date 2026-05-01.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import SafeModeToggle from "./SafeModeToggle";
import { useSafeModeStore, SAFE_MODE_STORAGE_KEY } from "@stores/safeModeStore";

describe("SafeModeToggle", () => {
  beforeEach(() => {
    localStorage.removeItem(SAFE_MODE_STORAGE_KEY);
    useSafeModeStore.setState({ mode: "strict" });
  });

  it('[AC-185-03a] strict renders shield-on + "Safe Mode" label', () => {
    render(<SafeModeToggle />);
    const btn = screen.getByRole("button", { name: "Safe Mode" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(btn).toHaveAttribute("data-mode", "strict");
    expect(btn).toHaveTextContent("Safe Mode");
  });

  it('[AC-185-03b] off renders shield-off + "Safe Mode: Off" label', () => {
    useSafeModeStore.setState({ mode: "off" });
    render(<SafeModeToggle />);
    const btn = screen.getByRole("button", { name: "Safe Mode: Off" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(btn).toHaveAttribute("data-mode", "off");
    expect(btn).toHaveTextContent("Safe Mode: Off");
  });

  it("[AC-185-03c] click toggles store mode (3-way: strict → warn first)", async () => {
    const user = userEvent.setup();
    render(<SafeModeToggle />);
    expect(useSafeModeStore.getState().mode).toBe("strict");
    await user.click(screen.getByRole("button", { name: "Safe Mode" }));
    expect(useSafeModeStore.getState().mode).toBe("warn");
  });

  it('[AC-186-02a] warn renders shield-alert + "Safe Mode: Warn" label + aria-pressed="mixed"', () => {
    useSafeModeStore.setState({ mode: "warn" });
    render(<SafeModeToggle />);
    const btn = screen.getByRole("button", { name: "Safe Mode: Warn" });
    expect(btn).toHaveAttribute("aria-pressed", "mixed");
    expect(btn).toHaveAttribute("data-mode", "warn");
    expect(btn).toHaveTextContent("Safe Mode: Warn");
  });

  it("[AC-186-02b] click cycles strict → warn → off → strict", async () => {
    const user = userEvent.setup();
    render(<SafeModeToggle />);
    expect(useSafeModeStore.getState().mode).toBe("strict");
    await user.click(screen.getByRole("button", { name: "Safe Mode" }));
    expect(useSafeModeStore.getState().mode).toBe("warn");
    await user.click(screen.getByRole("button", { name: "Safe Mode: Warn" }));
    expect(useSafeModeStore.getState().mode).toBe("off");
    await user.click(screen.getByRole("button", { name: "Safe Mode: Off" }));
    expect(useSafeModeStore.getState().mode).toBe("strict");
  });

  // [HF-187-A1] — per-mode `title` tooltip pins three contract pieces:
  //   1. heading line names the mode AND its next click action;
  //   2. strict tooltip surfaces the canonical blocked-statement set so the
  //      copy can't drift away from `analyzeStatement`;
  //   3. non-production scoping note appears in the gating modes
  //      (strict / warn) so users on local don't think they're being
  //      blocked.
  // We test through the rendered DOM `title` attribute rather than mocking
  // a tooltip primitive — the toolbar uses native browser tooltips for
  // every sibling button (DisconnectButton, HistoryButton), so this is the
  // real user-visible surface. date 2026-05-01.
  it("[HF-187-A1] per-mode tooltip exposes mode summary + danger statements + scoping note", () => {
    const { rerender } = render(<SafeModeToggle />);
    const strictTitle = screen
      .getByRole("button", { name: "Safe Mode" })
      .getAttribute("title");
    expect(strictTitle).toMatch(
      /Safe Mode: Strict \(click to switch to warn\)/,
    );
    expect(strictTitle).toMatch(
      /DROP TABLE \/ DATABASE \/ SCHEMA \/ INDEX \/ VIEW/,
    );
    expect(strictTitle).toMatch(/UPDATE \/ DELETE without WHERE/);
    expect(strictTitle).toMatch(/Non-production environments .* never gated/);

    useSafeModeStore.setState({ mode: "warn" });
    rerender(<SafeModeToggle />);
    const warnTitle = screen
      .getByRole("button", { name: "Safe Mode: Warn" })
      .getAttribute("title");
    expect(warnTitle).toMatch(/Safe Mode: Warn \(click to disable\)/);
    expect(warnTitle).toMatch(/type-to-confirm/);
    expect(warnTitle).toMatch(/Non-production environments are never gated/);

    useSafeModeStore.setState({ mode: "off" });
    rerender(<SafeModeToggle />);
    const offTitle = screen
      .getByRole("button", { name: "Safe Mode: Off" })
      .getAttribute("title");
    expect(offTitle).toMatch(
      /Safe Mode: Off \(click to re-enable production guard\)/,
    );
    expect(offTitle).toMatch(/No guard\./);
  });
});
