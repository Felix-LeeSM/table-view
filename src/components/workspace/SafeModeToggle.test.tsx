// AC-185-03 — SafeModeToggle component tests. 3 cases per Sprint 185 contract.
// AC-186-02 — Sprint 186 adds warn-mode visual + 3-way cycle.
// Post-Sprint-187 hotfix (HF-187-A) — verbose info HoverCard wrapping the
// toggle itself + colour-free styling. The hover-trigger model replaces an
// earlier sibling Info-button design after user feedback ("hovering 만으로
// 떴으면 좋겠다"). One new case asserts the help content is reachable via
// pointer hover and surfaces the Strict / Warn / Off descriptions plus the
// non-production scoping note. date 2026-05-01.
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

  // [HF-187-A1] — hovering the SafeMode button reveals the verbose help
  // HoverCard. Asserting on the visible copy (Strict / Warn / Off headings
  // + canonical danger statement examples + non-production scoping note)
  // pins both the hover wiring and the help-text content as a single
  // regression net. The hover MUST NOT change the safe-mode state — a
  // toggle requires an explicit click. date 2026-05-01.
  it("[HF-187-A1] hover surfaces help content without mutating mode", async () => {
    const user = userEvent.setup();
    render(<SafeModeToggle />);
    const btn = screen.getByRole("button", { name: "Safe Mode" });
    await user.hover(btn);

    expect(await screen.findByText("About Safe Mode")).toBeInTheDocument();
    expect(screen.getByText("Strict")).toBeInTheDocument();
    expect(screen.getByText("Warn")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(
      screen.getByText(/DROP TABLE \/ DATABASE \/ SCHEMA \/ INDEX \/ VIEW/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Non-production environments .* are never gated\./),
    ).toBeInTheDocument();
    // Hover-only path must not have toggled the store.
    expect(useSafeModeStore.getState().mode).toBe("strict");
  });
});
