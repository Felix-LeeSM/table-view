import { describe, it, expect, beforeEach } from "vitest";
import { useMruStore, __resetMruStoreForTests } from "./mruStore";

// Sprint 119 (#SHELL-1) — MRU connection store unit tests. Covers initial
// state, action side-effect (state + localStorage), and boot-time restore.

const STORAGE_KEY = "table-view-mru";

beforeEach(() => {
  __resetMruStoreForTests();
});

describe("mruStore", () => {
  it("starts with lastUsedConnectionId === null", () => {
    expect(useMruStore.getState().lastUsedConnectionId).toBeNull();
  });

  it("markConnectionUsed updates state and writes to localStorage", () => {
    useMruStore.getState().markConnectionUsed("c1");

    expect(useMruStore.getState().lastUsedConnectionId).toBe("c1");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("c1");
  });

  it("markConnectionUsed overwrites previous value (most-recent wins)", () => {
    useMruStore.getState().markConnectionUsed("c1");
    useMruStore.getState().markConnectionUsed("c2");

    expect(useMruStore.getState().lastUsedConnectionId).toBe("c2");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("c2");
  });

  it("loadPersistedMru restores the persisted id on boot", () => {
    window.localStorage.setItem(STORAGE_KEY, "c-restored");

    useMruStore.getState().loadPersistedMru();

    expect(useMruStore.getState().lastUsedConnectionId).toBe("c-restored");
  });

  it("loadPersistedMru yields null when storage is empty", () => {
    // Storage already cleared by beforeEach.
    useMruStore.getState().loadPersistedMru();

    expect(useMruStore.getState().lastUsedConnectionId).toBeNull();
  });

  it("loadPersistedMru yields null when storage holds an empty string", () => {
    // Defensive: an explicit empty value should be treated as "no MRU"
    // rather than a valid id, so the EmptyState fallback kicks in.
    window.localStorage.setItem(STORAGE_KEY, "");

    useMruStore.getState().loadPersistedMru();

    expect(useMruStore.getState().lastUsedConnectionId).toBeNull();
  });

  it("__resetMruStoreForTests clears both state and localStorage", () => {
    useMruStore.getState().markConnectionUsed("c-leak");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("c-leak");

    __resetMruStoreForTests();

    expect(useMruStore.getState().lastUsedConnectionId).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
