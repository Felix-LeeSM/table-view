// AC-185-02 — safeModeStore unit tests. 5 cases per Sprint 185 contract.
// date 2026-05-01.
import { describe, it, expect, beforeEach } from "vitest";
import {
  useSafeModeStore,
  SAFE_MODE_STORAGE_KEY,
  SYNCED_KEYS,
} from "./safeModeStore";

describe("safeModeStore", () => {
  beforeEach(() => {
    localStorage.removeItem(SAFE_MODE_STORAGE_KEY);
    useSafeModeStore.setState({ mode: "strict" });
  });

  it('[AC-185-02a] default mode is "strict"', () => {
    expect(useSafeModeStore.getState().mode).toBe("strict");
  });

  it("[AC-185-02b] setMode updates mode", () => {
    useSafeModeStore.getState().setMode("off");
    expect(useSafeModeStore.getState().mode).toBe("off");
    useSafeModeStore.getState().setMode("strict");
    expect(useSafeModeStore.getState().mode).toBe("strict");
  });

  it("[AC-185-02c] toggle flips strict↔off", () => {
    expect(useSafeModeStore.getState().mode).toBe("strict");
    useSafeModeStore.getState().toggle();
    expect(useSafeModeStore.getState().mode).toBe("off");
    useSafeModeStore.getState().toggle();
    expect(useSafeModeStore.getState().mode).toBe("strict");
  });

  it("[AC-185-02d] persists to localStorage", () => {
    useSafeModeStore.getState().setMode("off");
    const raw = localStorage.getItem(SAFE_MODE_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.mode).toBe("off");
  });

  it('[AC-185-02e] SYNCED_KEYS exactly ["mode"]', () => {
    expect(SYNCED_KEYS).toEqual(["mode"]);
  });
});
