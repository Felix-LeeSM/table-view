/**
 * session-storage.ts — session-scoped localStorage tests.
 *
 * Reason: verify that session UUID tagging correctly distinguishes current
 * session data from stale data left by a previous app run, and that
 * connection store hydration reads/writes the correct keys. (2026-04-28)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock connectionStore to avoid importing the real Zustand store
vi.mock("@stores/connectionStore", () => ({
  useConnectionStore: {
    getState: vi.fn(() => ({
      hydrateFromSession: vi.fn(),
    })),
    setState: vi.fn(),
  },
}));

describe("session-storage", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
        clear: () => store.clear(),
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() {
          return store.size;
        },
      },
    });
  });

  afterEach(() => {
    vi.resetModules();
  });

  // Reason: initSession must cache the UUID from Rust so subsequent
  // sessionSet/sessionGet calls use it. (2026-04-28)
  it("initSession caches the session ID from Rust", async () => {
    mockInvoke.mockResolvedValue("test-uuid-123");
    const { initSession, getSessionId } = await import("@lib/session-storage");
    await initSession();
    expect(getSessionId()).toBe("test-uuid-123");
  });

  // Reason: data written under one session ID must be readable under the
  // same session ID. (2026-04-28)
  it("sessionSet then sessionGet returns data for same session", async () => {
    mockInvoke.mockResolvedValue("aaa");
    const { initSession, sessionSet, sessionGet } =
      await import("@lib/session-storage");
    await initSession();
    sessionSet("key1", { connId: "c1" });
    expect(sessionGet("key1")).toEqual({ connId: "c1" });
  });

  // Reason: after a new app start, the session ID changes. Data from the
  // old session must be ignored — this is the core value of session UUIDs.
  // (2026-04-28)
  it("sessionGet returns null for stale session data", async () => {
    // First session writes data
    mockInvoke.mockResolvedValue("old-session");
    const mod1 = await import("@lib/session-storage");
    await mod1.initSession();
    mod1.sessionSet("key1", "old-data");

    // Simulate new app start: reset modules, new session ID
    vi.resetModules();
    mockInvoke.mockResolvedValue("new-session");
    const mod2 = await import("@lib/session-storage");
    await mod2.initSession();

    // The old data should be invisible
    expect(mod2.sessionGet("key1")).toBeNull();
  });

  // Reason: sessionGet must handle missing keys and malformed JSON
  // gracefully. (2026-04-28)
  it("sessionGet returns null for missing or malformed keys", async () => {
    mockInvoke.mockResolvedValue("sid");
    const { initSession, sessionGet } = await import("@lib/session-storage");
    await initSession();
    expect(sessionGet("nonexistent")).toBeNull();
    // Manually write garbage
    store.set("garbage", "not-json");
    expect(sessionGet("garbage")).toBeNull();
  });

  // Reason: sessionRemove must delete the key from localStorage.
  // (2026-04-28)
  it("sessionRemove deletes the key", async () => {
    mockInvoke.mockResolvedValue("sid");
    const { initSession, sessionSet, sessionGet, sessionRemove } =
      await import("@lib/session-storage");
    await initSession();
    sessionSet("k", "v");
    expect(sessionGet("k")).toBe("v");
    sessionRemove("k");
    expect(sessionGet("k")).toBeNull();
  });
});
