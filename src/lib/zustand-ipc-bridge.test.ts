/**
 * Sprint 151 — TDD-FIRST contract tests for the Zustand-over-Tauri-events bridge.
 *
 * Authored BEFORE the production module (`src/lib/zustand-ipc-bridge.ts`).
 * Against pre-Sprint-151 code, the import below fails — the module does not
 * yet exist (vitest reports a "module not found" / "Failed to resolve import"
 * error). After the production module ships, the same file goes green.
 *
 * Contract surface verified:
 *  - (a) local→emit: `setState` on an allowlisted key triggers exactly one
 *    outbound `emit` carrying the new payload.
 *  - (b) inbound→no re-emit: an inbound `event.listen` payload applies to the
 *    local store and produces ZERO new outbound emits (loop guard).
 *  - (c) allowlist filter (both directions): a key not in the allowlist
 *    (e.g. `password`, `__transient`) is NOT broadcast outbound and an inbound
 *    payload containing only such keys is NOT applied locally.
 *  - (d) two-store convergence: two zustand stores attached to the same
 *    channel name in the same test process (simulating two windows) converge
 *    after a write on either side, via a shared in-memory event bus.
 *  - (e) error path: malformed inbound payload (wrong shape, JSON.parse
 *    failure, missing keys) is silently ignored — does NOT throw or pollute
 *    store state.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";

// ---------------------------------------------------------------------------
// Shared in-process event bus mock for `@tauri-apps/api/event`.
//
// The real Tauri event bus is process-spanning: an `emit` on window A is seen
// by `listen` on window B. We can't run two windows in jsdom, so we simulate
// the bus with a Map<event, Set<listener>>. Both `emit` and `listen` route
// through this map. The mock is hoisted (top-level `vi.mock`) so it's set up
// BEFORE the bridge module's imports are resolved.
// ---------------------------------------------------------------------------

interface BusEnvelope {
  event: string;
  payload: unknown;
  // The bus echoes the originating window label/origin id so the bridge's
  // loop guard has a deterministic channel to suppress self-events. The mock
  // does not generate this — the bridge attaches it to the payload.
}

type BusListener = (env: BusEnvelope) => void;
const bus = new Map<string, Set<BusListener>>();

function busEmit(event: string, payload: unknown): void {
  const listeners = bus.get(event);
  if (!listeners) return;
  // Iterate over a snapshot so a listener that subscribes mid-dispatch
  // doesn't see the in-flight event (matches Tauri's broadcast-and-snapshot
  // semantics closely enough for these tests).
  for (const listener of [...listeners]) {
    listener({ event, payload });
  }
}

function busListen(event: string, listener: BusListener): () => void {
  let set = bus.get(event);
  if (!set) {
    set = new Set();
    bus.set(event, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
  };
}

function busReset(): void {
  bus.clear();
}

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async (event: string, payload?: unknown) => {
    busEmit(event, payload);
  }),
  listen: vi.fn(async (event: string, handler: (e: BusEnvelope) => void) => {
    return busListen(event, handler);
  }),
}));

// Import AFTER the mock above is registered.
import {
  attachZustandIpcBridge,
  type ZustandIpcBridgeOptions,
} from "@lib/zustand-ipc-bridge";
import { emit, listen } from "@tauri-apps/api/event";

const mockedEmit = emit as unknown as Mock;
const mockedListen = listen as unknown as Mock;

// ---------------------------------------------------------------------------
// Test fixtures — a small store shape with synced and ephemeral keys.
// ---------------------------------------------------------------------------

interface TestState {
  themeId: string;
  mode: "light" | "dark" | "system";
  password: string; // never broadcast (sensitive)
  __transient: number; // window-local ephemeral counter
}

function makeTestStore(initial?: Partial<TestState>): StoreApi<TestState> {
  return createStore<TestState>(() => ({
    themeId: "default",
    mode: "system",
    password: "",
    __transient: 0,
    ...initial,
  }));
}

const SYNC_KEYS: ReadonlyArray<keyof TestState> = ["themeId", "mode"];

// Convenience: attach the bridge with a stable channel name and waiting for
// listen() to settle, since `listen` is async in real Tauri.
async function attach<T>(
  store: StoreApi<T>,
  channel: string,
  options: Partial<ZustandIpcBridgeOptions<T>> = {},
): Promise<() => void> {
  const dispose = await attachZustandIpcBridge<T>(store, {
    channel,
    syncKeys: (options.syncKeys ?? SYNC_KEYS) as ReadonlyArray<keyof T>,
    originId: options.originId ?? "test-origin",
    ...options,
  });
  return dispose;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("zustand-ipc-bridge", () => {
  beforeEach(() => {
    busReset();
    mockedEmit.mockClear();
    mockedListen.mockClear();
  });

  afterEach(() => {
    busReset();
  });

  // (a) local→emit
  it("AC-151-02a: a local setState on a synced key triggers exactly one outbound emit", async () => {
    const store = makeTestStore();
    const dispose = await attach(store, "test-channel", {
      originId: "winA",
    });

    expect(mockedEmit).not.toHaveBeenCalled();

    store.setState({ themeId: "ocean" });

    // Allow any microtask the bridge schedules.
    await Promise.resolve();

    expect(mockedEmit).toHaveBeenCalledTimes(1);
    const [event, payload] = mockedEmit.mock.calls[0]!;
    expect(event).toBe("test-channel");
    // Payload must include the new value for the synced key.
    expect(payload).toMatchObject({ state: { themeId: "ocean" } });
    // Origin id is part of the loop-guard envelope.
    expect(payload).toMatchObject({ origin: "winA" });

    dispose();
  });

  // (b) inbound→no re-emit (loop guard)
  it("AC-151-02b: an inbound payload applies to the local store and produces NO outbound re-emit", async () => {
    const store = makeTestStore();
    const dispose = await attach(store, "test-channel", { originId: "winA" });

    // Simulate a remote window emitting a state diff. The remote envelope
    // carries a different origin id so the bridge accepts and applies it.
    busEmit("test-channel", {
      origin: "winB",
      state: { themeId: "midnight", mode: "dark" },
    });

    await Promise.resolve();

    // Local state was updated.
    expect(store.getState().themeId).toBe("midnight");
    expect(store.getState().mode).toBe("dark");

    // No re-emit: the bridge must NOT broadcast the inbound diff back out.
    expect(mockedEmit).not.toHaveBeenCalled();

    dispose();
  });

  // (b'): even after the inbound apply, a subsequent local change still emits exactly once.
  it("AC-151-02b': after an inbound apply, a follow-up local change still emits exactly once", async () => {
    const store = makeTestStore();
    const dispose = await attach(store, "test-channel", { originId: "winA" });

    busEmit("test-channel", {
      origin: "winB",
      state: { themeId: "midnight" },
    });
    await Promise.resolve();
    expect(mockedEmit).not.toHaveBeenCalled();

    store.setState({ themeId: "sunrise" });
    await Promise.resolve();
    expect(mockedEmit).toHaveBeenCalledTimes(1);

    dispose();
  });

  // (c) allowlist filter — outbound
  it("AC-151-02c-out: a setState on a non-allowlisted key (password) is NOT broadcast", async () => {
    const store = makeTestStore();
    const dispose = await attach(store, "test-channel", { originId: "winA" });

    store.setState({ password: "hunter2" });
    await Promise.resolve();

    expect(mockedEmit).not.toHaveBeenCalled();
    expect(store.getState().password).toBe("hunter2");

    dispose();
  });

  // (c) allowlist filter — outbound (mixed update only emits the allowlisted slice)
  it("AC-151-02c-mix: a mixed setState only broadcasts the allowlisted subset", async () => {
    const store = makeTestStore();
    const dispose = await attach(store, "test-channel", { originId: "winA" });

    store.setState({ themeId: "ocean", password: "hunter2", __transient: 7 });
    await Promise.resolve();

    expect(mockedEmit).toHaveBeenCalledTimes(1);
    const payload = mockedEmit.mock.calls[0]?.[1] as {
      state: Record<string, unknown>;
    };
    // Broadcast carries the full allowlisted slice (themeId + mode), so the
    // remote applies a consistent picture of the synced surface. The point
    // of this case is that non-allowlisted keys (password, __transient) are
    // NOT in the broadcast.
    expect(payload.state).toMatchObject({ themeId: "ocean" });
    expect(payload.state).not.toHaveProperty("password");
    expect(payload.state).not.toHaveProperty("__transient");
    expect(Object.keys(payload.state).sort()).toEqual(["mode", "themeId"]);

    dispose();
  });

  // (c) allowlist filter — inbound (defense-in-depth)
  it("AC-151-02c-in: an inbound payload that contains only non-allowlisted keys is NOT applied locally", async () => {
    const store = makeTestStore({ password: "original" });
    const dispose = await attach(store, "test-channel", { originId: "winA" });

    busEmit("test-channel", {
      origin: "winB",
      state: { password: "leaked", __transient: 99 },
    });
    await Promise.resolve();

    expect(store.getState().password).toBe("original");
    expect(store.getState().__transient).toBe(0);
    expect(mockedEmit).not.toHaveBeenCalled();

    dispose();
  });

  // (c) allowlist filter — inbound (mixed: only the allowlisted slice is applied)
  it("AC-151-02c-in-mix: an inbound payload mixing allowlisted and non-allowlisted keys only applies the allowlisted slice", async () => {
    const store = makeTestStore({ password: "original" });
    const dispose = await attach(store, "test-channel", { originId: "winA" });

    busEmit("test-channel", {
      origin: "winB",
      state: { themeId: "sunset", password: "leaked" },
    });
    await Promise.resolve();

    expect(store.getState().themeId).toBe("sunset");
    expect(store.getState().password).toBe("original");
    expect(mockedEmit).not.toHaveBeenCalled();

    dispose();
  });

  // (d) two-store convergence
  it("AC-151-02d: two stores on the same channel converge after a write on either side", async () => {
    const storeA = makeTestStore();
    const storeB = makeTestStore();

    const disposeA = await attach(storeA, "convergence-channel", {
      originId: "winA",
    });
    const disposeB = await attach(storeB, "convergence-channel", {
      originId: "winB",
    });

    // Write on side A → both stores reflect it.
    storeA.setState({ themeId: "ocean", mode: "dark" });
    await Promise.resolve();
    await Promise.resolve();

    expect(storeA.getState().themeId).toBe("ocean");
    expect(storeB.getState().themeId).toBe("ocean");
    expect(storeB.getState().mode).toBe("dark");

    // Now write on side B → A converges. B's outbound emit should only fire
    // because of B's local change, not because A's earlier change echoed back.
    const emitsBefore = mockedEmit.mock.calls.length;
    storeB.setState({ themeId: "sunrise" });
    await Promise.resolve();
    await Promise.resolve();

    expect(storeA.getState().themeId).toBe("sunrise");
    expect(storeB.getState().themeId).toBe("sunrise");
    // Exactly one new emit (B's), not a re-broadcast loop.
    expect(mockedEmit.mock.calls.length).toBe(emitsBefore + 1);

    disposeA();
    disposeB();
  });

  // (d'): same store writing on the same value twice does NOT emit twice.
  it("AC-151-02d': writing the same allowlisted value twice only emits on the actual change", async () => {
    const store = makeTestStore();
    const dispose = await attach(store, "noop-channel", { originId: "winA" });

    store.setState({ themeId: "ocean" });
    await Promise.resolve();
    expect(mockedEmit).toHaveBeenCalledTimes(1);

    // No-op set: nothing changed in the broadcast subset.
    store.setState({ themeId: "ocean" });
    await Promise.resolve();
    expect(mockedEmit).toHaveBeenCalledTimes(1);

    dispose();
  });

  // (e) error path — malformed inbound payload
  it("AC-151-02e: a malformed inbound payload is silently ignored (no throw, no state change)", async () => {
    const store = makeTestStore({ themeId: "default" });
    const dispose = await attach(store, "err-channel", { originId: "winA" });

    // Each of these payloads is deliberately broken in a different way.
    expect(() => {
      busEmit("err-channel", null);
      busEmit("err-channel", "not-an-object");
      busEmit("err-channel", { origin: "winB" }); // missing `state`
      busEmit("err-channel", { origin: "winB", state: "not-an-object" });
      busEmit("err-channel", { origin: "winB", state: null });
      // `state` is an object but with no allowlisted keys.
      busEmit("err-channel", { origin: "winB", state: { unknownKey: 1 } });
    }).not.toThrow();

    await Promise.resolve();

    // State must be untouched.
    expect(store.getState().themeId).toBe("default");
    expect(store.getState().mode).toBe("system");
    expect(mockedEmit).not.toHaveBeenCalled();

    dispose();
  });

  // (e'): inbound from the SAME origin id is ignored (loop-guard self-event suppression).
  it("AC-151-02e': an inbound payload tagged with the same origin id is ignored (self-loop guard)", async () => {
    const store = makeTestStore();
    const dispose = await attach(store, "self-channel", { originId: "winA" });

    busEmit("self-channel", {
      origin: "winA", // same origin = our own echo
      state: { themeId: "echoed" },
    });
    await Promise.resolve();

    // Should NOT apply — this would cause double-application in real Tauri
    // if the runtime echoes our own emit back at us.
    expect(store.getState().themeId).toBe("default");
    expect(mockedEmit).not.toHaveBeenCalled();

    dispose();
  });

  // dispose contract
  it("dispose tears down the listener and unsubscribes from the store (no emits after dispose)", async () => {
    const store = makeTestStore();
    const dispose = await attach(store, "dispose-channel", {
      originId: "winA",
    });

    dispose();

    store.setState({ themeId: "after-dispose" });
    await Promise.resolve();
    expect(mockedEmit).not.toHaveBeenCalled();

    // Inbound emits after dispose are no-ops.
    busEmit("dispose-channel", {
      origin: "winB",
      state: { themeId: "remote" },
    });
    await Promise.resolve();
    expect(store.getState().themeId).toBe("after-dispose");
  });
});
