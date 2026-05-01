// AC-185-03 — SafeModeToggle component tests. 3 cases per Sprint 185 contract.
// date 2026-05-01.
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

  it("[AC-185-03c] click toggles store mode", async () => {
    const user = userEvent.setup();
    render(<SafeModeToggle />);
    expect(useSafeModeStore.getState().mode).toBe("strict");
    await user.click(screen.getByRole("button", { name: "Safe Mode" }));
    expect(useSafeModeStore.getState().mode).toBe("off");
    await user.click(screen.getByRole("button", { name: "Safe Mode: Off" }));
    expect(useSafeModeStore.getState().mode).toBe("strict");
  });
});
