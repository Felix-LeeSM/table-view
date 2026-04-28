import { describe, it, expect, beforeEach } from "vitest";
import { useMruStore, __resetMruStoreForTests, SYNCED_KEYS } from "./mruStore";

// Sprint 119 (#SHELL-1) — MRU connection store unit tests. Covers initial
// state, action side-effect (state + localStorage), and boot-time restore.
// Sprint 166 — expanded to cover list-based MRU tracking (up to 5 entries).

const STORAGE_KEY = "table-view-mru";

beforeEach(() => {
  __resetMruStoreForTests();
});

describe("mruStore", () => {
  it("starts with lastUsedConnectionId === null", () => {
    expect(useMruStore.getState().lastUsedConnectionId).toBeNull();
  });

  // Reason: backward compat — markConnectionUsed still updates lastUsedConnectionId (2026-04-28)
  it("markConnectionUsed updates state and writes to localStorage", () => {
    useMruStore.getState().markConnectionUsed("c1");

    expect(useMruStore.getState().lastUsedConnectionId).toBe("c1");
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toEqual([
      { connectionId: "c1", lastUsed: expect.any(Number) },
    ]);
  });

  // Reason: backward compat — newer id overwrites older, list has single entry (2026-04-28)
  it("markConnectionUsed overwrites previous value (most-recent wins)", () => {
    useMruStore.getState().markConnectionUsed("c1");
    useMruStore.getState().markConnectionUsed("c2");

    expect(useMruStore.getState().lastUsedConnectionId).toBe("c2");
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    // Most recent first
    expect(parsed[0].connectionId).toBe("c2");
    expect(parsed[1].connectionId).toBe("c1");
  });

  // Reason: backward compat — restore from new JSON array format (2026-04-28)
  it("loadPersistedMru restores the persisted id on boot", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ connectionId: "c-restored", lastUsed: 1000 }]),
    );

    useMruStore.getState().loadPersistedMru();

    expect(useMruStore.getState().lastUsedConnectionId).toBe("c-restored");
  });

  it("loadPersistedMru yields null when storage is empty", () => {
    // Storage already cleared by beforeEach.
    useMruStore.getState().loadPersistedMru();

    expect(useMruStore.getState().lastUsedConnectionId).toBeNull();
  });

  // Reason: backward compat — empty string in old format treated as no MRU (2026-04-28)
  it("loadPersistedMru yields null when storage holds an empty string", () => {
    // Defensive: an explicit empty value should be treated as "no MRU"
    // rather than a valid id, so the EmptyState fallback kicks in.
    window.localStorage.setItem(STORAGE_KEY, "");

    useMruStore.getState().loadPersistedMru();

    expect(useMruStore.getState().lastUsedConnectionId).toBeNull();
  });

  it("__resetMruStoreForTests clears both state and localStorage", () => {
    useMruStore.getState().markConnectionUsed("c-leak");
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    __resetMruStoreForTests();

    expect(useMruStore.getState().lastUsedConnectionId).toBeNull();
    expect(useMruStore.getState().recentConnections).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  // -- Sprint 153 (AC-153-06) — cross-window broadcast allowlist regression --
  //
  // `SYNCED_KEYS` pins which top-level state keys are broadcast on the
  // `mru-sync` channel. Adding a new key to `MruState` MUST be a deliberate
  // opt-in/opt-out decision — silently leaking a sensitive new field across
  // windows is the failure mode this regression guards against.
  describe("SYNCED_KEYS allowlist (AC-153-06)", () => {
    // Reason: Sprint 166 added recentConnections to the sync allowlist (2026-04-28)
    it("exposes exactly the cross-window-synced keys", () => {
      expect([...SYNCED_KEYS]).toEqual([
        "lastUsedConnectionId",
        "recentConnections",
      ]);
    });
  });
});

// -- Sprint 166 — MRU list feature tests (Phase 16) --

describe("MRU list (Sprint 166)", () => {
  // Reason: Phase 16 AC-16-01 — markConnectionUsed adds entry to front of recentConnections (2026-04-28)
  it("adds entry to front of recentConnections", () => {
    useMruStore.getState().markConnectionUsed("c1");

    const { recentConnections } = useMruStore.getState();
    expect(recentConnections).toHaveLength(1);
    expect(recentConnections[0]).toEqual({
      connectionId: "c1",
      lastUsed: expect.any(Number),
    });
  });

  // Reason: Phase 16 AC-16-02 — reusing an existing id moves it to front without duplicates (2026-04-28)
  it("moves existing entry to front on reuse (no duplicates)", () => {
    useMruStore.getState().markConnectionUsed("c1");
    useMruStore.getState().markConnectionUsed("c2");
    useMruStore.getState().markConnectionUsed("c3");

    // Reuse c1 — should move to front, not add a duplicate
    useMruStore.getState().markConnectionUsed("c1");

    const { recentConnections } = useMruStore.getState();
    expect(recentConnections).toHaveLength(3);
    expect(recentConnections[0]!.connectionId).toBe("c1");
    expect(recentConnections[1]!.connectionId).toBe("c3");
    expect(recentConnections[2]!.connectionId).toBe("c2");

    // No duplicate ids
    const ids = recentConnections.map((e) => e.connectionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Reason: Phase 16 AC-16-03 — list caps at 5 entries, oldest removed (2026-04-28)
  it("caps list at 5 entries, removing oldest", () => {
    for (let i = 1; i <= 7; i++) {
      useMruStore.getState().markConnectionUsed(`c${i}`);
    }

    const { recentConnections } = useMruStore.getState();
    expect(recentConnections).toHaveLength(5);
    // Most recent first: c7, c6, c5, c4, c3
    expect(recentConnections[0]!.connectionId).toBe("c7");
    expect(recentConnections[4]!.connectionId).toBe("c3");
    // c1 and c2 should have been evicted
    const ids = recentConnections.map((e) => e.connectionId);
    expect(ids).not.toContain("c1");
    expect(ids).not.toContain("c2");
  });

  // Reason: Phase 16 AC-16-04 — recentConnections persisted as JSON array to localStorage (2026-04-28)
  it("persists recentConnections as JSON array to localStorage", () => {
    useMruStore.getState().markConnectionUsed("c1");
    useMruStore.getState().markConnectionUsed("c2");

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toEqual([
      { connectionId: "c2", lastUsed: expect.any(Number) },
      { connectionId: "c1", lastUsed: expect.any(Number) },
    ]);
  });

  // Reason: Phase 16 AC-16-04 — app restart restores recentConnections from localStorage (2026-04-28)
  it("restores recentConnections from localStorage on loadPersistedMru", () => {
    const entries = [
      { connectionId: "c3", lastUsed: 3000 },
      { connectionId: "c2", lastUsed: 2000 },
      { connectionId: "c1", lastUsed: 1000 },
    ];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));

    useMruStore.getState().loadPersistedMru();

    const { recentConnections, lastUsedConnectionId } = useMruStore.getState();
    expect(recentConnections).toEqual(entries);
    // lastUsedConnectionId derived from first entry
    expect(lastUsedConnectionId).toBe("c3");
  });

  // Reason: Phase 16 AC-16-06 — migration from old single-string format to list (2026-04-28)
  it("migrates old single-string format to list", () => {
    // Simulate legacy format: just a plain string, not JSON array
    window.localStorage.setItem(STORAGE_KEY, "legacy-conn-id");

    useMruStore.getState().loadPersistedMru();

    const { recentConnections, lastUsedConnectionId } = useMruStore.getState();
    expect(recentConnections).toHaveLength(1);
    expect(recentConnections[0]!.connectionId).toBe("legacy-conn-id");
    expect(recentConnections[0]!.lastUsed).toBeGreaterThan(0);
    expect(lastUsedConnectionId).toBe("legacy-conn-id");
  });
});
