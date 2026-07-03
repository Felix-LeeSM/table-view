import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri event lib boundary (IPC): capture emit + the listen callback.
const mockEmit = vi.fn().mockResolvedValue(undefined);
type ListenCb = (e: { payload: unknown }) => void;
const mockListenState: { channel?: string; cb?: ListenCb } = {};
vi.mock("@tauri-apps/api/event", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  listen: (channel: string, cb: ListenCb) => {
    mockListenState.channel = channel;
    mockListenState.cb = cb;
    return Promise.resolve(() => {});
  },
}));

import {
  dispatchLocalIntent,
  forwardIntent,
  subscribeIntents,
  QUICK_OPEN_INTENT_CHANNEL,
  type QuickOpenIntent,
} from "@lib/quickOpenIntent";

describe("quickOpenIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListenState.channel = undefined;
    mockListenState.cb = undefined;
  });

  it("dispatchLocalIntent maps a schema intent to reveal-schema", () => {
    const handler = vi.fn();
    window.addEventListener("reveal-schema", handler);
    dispatchLocalIntent({
      kind: "schema",
      connectionId: "c1",
      schema: "sales",
    });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { connectionId: "c1", schema: "sales" },
      }),
    );
    window.removeEventListener("reveal-schema", handler);
  });

  it("dispatchLocalIntent maps a function intent to quickopen-function", () => {
    const handler = vi.fn();
    window.addEventListener("quickopen-function", handler);
    dispatchLocalIntent({
      kind: "function",
      connectionId: "c1",
      source: "SELECT 1",
      title: "public.f",
    });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { connectionId: "c1", source: "SELECT 1", title: "public.f" },
      }),
    );
    window.removeEventListener("quickopen-function", handler);
  });

  it("dispatchLocalIntent maps a view intent to navigate-table with objectKind", () => {
    const handler = vi.fn();
    window.addEventListener("navigate-table", handler);
    dispatchLocalIntent({
      kind: "view",
      connectionId: "c1",
      schema: "public",
      table: "active_users",
    });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          connectionId: "c1",
          schema: "public",
          table: "active_users",
          objectKind: "view",
        },
      }),
    );
    window.removeEventListener("navigate-table", handler);
  });

  it("forwardIntent emits on the intent channel", async () => {
    const intent: QuickOpenIntent = {
      kind: "table",
      connectionId: "c2",
      schema: "public",
      table: "orders",
    };
    await forwardIntent(intent);
    expect(mockEmit).toHaveBeenCalledWith(QUICK_OPEN_INTENT_CHANNEL, intent);
  });

  it("subscribeIntents applies only intents addressed to the own connection", async () => {
    const apply = vi.fn();
    await subscribeIntents("c1", apply);
    expect(mockListenState.channel).toBe(QUICK_OPEN_INTENT_CHANNEL);

    // Another connection's intent is dropped (a broadcast reaches every window).
    mockListenState.cb!({
      payload: { kind: "schema", connectionId: "c2", schema: "x" },
    });
    expect(apply).not.toHaveBeenCalled();

    // The own connection's intent is applied.
    const own = { kind: "schema", connectionId: "c1", schema: "sales" };
    mockListenState.cb!({ payload: own });
    expect(apply).toHaveBeenCalledWith(own);
  });
});
