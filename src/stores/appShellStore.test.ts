import { describe, it, expect, beforeEach } from "vitest";
import { useAppShellStore } from "./appShellStore";
import { useTabStore } from "./tabStore";

describe("appShellStore", () => {
  beforeEach(() => {
    // Reset to the documented initial value before every test so suites do
    // not pollute each other. We deliberately use setState (vs. recreating
    // the store) to mirror how the production codebase resets stores in
    // tests — see tabStore.test.ts.
    useAppShellStore.setState({ screen: "home" });
    useTabStore.setState({ tabs: [], activeTabId: null });
  });

  it("initial screen is 'home'", () => {
    expect(useAppShellStore.getState().screen).toBe("home");
  });

  it("setScreen('workspace') flips to workspace", () => {
    useAppShellStore.getState().setScreen("workspace");
    expect(useAppShellStore.getState().screen).toBe("workspace");
  });

  it("setScreen can swap back to home after workspace", () => {
    useAppShellStore.getState().setScreen("workspace");
    expect(useAppShellStore.getState().screen).toBe("workspace");
    useAppShellStore.getState().setScreen("home");
    expect(useAppShellStore.getState().screen).toBe("home");
  });

  it("setScreen with the current value is a no-op (idempotent)", () => {
    const before = useAppShellStore.getState();
    before.setScreen("home");
    const after = useAppShellStore.getState();
    // Same reference — no spurious re-renders for selectors comparing by ===
    expect(after).toBe(before);
  });

  it("does not reset tabStore when the screen swaps", () => {
    // Seed a tab so we can prove cross-store independence.
    useTabStore.setState({
      tabs: [
        {
          type: "table",
          id: "tab-keep",
          title: "users",
          connectionId: "c1",
          closable: true,
          schema: "public",
          table: "users",
          subView: "records",
        },
      ],
      activeTabId: "tab-keep",
    });

    useAppShellStore.getState().setScreen("workspace");
    useAppShellStore.getState().setScreen("home");
    useAppShellStore.getState().setScreen("workspace");

    const tabs = useTabStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.id).toBe("tab-keep");
    expect(useTabStore.getState().activeTabId).toBe("tab-keep");
  });
});
