// #1362 — the shared request-race guard behind documentCatalogStore /
// documentQueryStore (supersede-on-request) and schemaStore
// (invalidate-on-teardown). Both flavors ride the same guard, so the unit test
// pins the two semantics that must never drift.
import { describe, it, expect } from "vitest";
import { createRequestGuard } from "./requestGuard";

describe("createRequestGuard", () => {
  it("next() supersedes an older in-flight request for the same key", () => {
    const guard = createRequestGuard();
    const first = guard.next("k");
    const second = guard.next("k");
    // Only the newest token is current; the older resolve is dropped.
    expect(guard.isCurrent("k", first)).toBe(false);
    expect(guard.isCurrent("k", second)).toBe(true);
  });

  it("writeIfCurrent commits when the token is unchanged across the await", async () => {
    const guard = createRequestGuard();
    let committed: string | null = null;
    await guard.writeIfCurrent(
      "conn",
      () => Promise.resolve("value"),
      (v) => {
        committed = v;
      },
    );
    expect(committed).toBe("value");
  });

  it("writeIfCurrent drops the write when bump() invalidates mid-flight", async () => {
    const guard = createRequestGuard();
    let committed: string | null = null;
    let resolve!: (v: string) => void;
    const inflight = guard.writeIfCurrent(
      "conn",
      () => new Promise<string>((r) => (resolve = r)),
      (v) => {
        committed = v;
      },
    );
    // Teardown supersedes the captured generation while the IPC is pending.
    guard.bump("conn");
    resolve("stale");
    await inflight;
    expect(committed).toBeNull();
  });

  it("bump() (not delete) is required for the token-0 capture: first request survives a live connection", async () => {
    const guard = createRequestGuard();
    // No prior next()/bump() — the fetcher captures generation 0. A teardown
    // that DELETED the key would reset to 0 and falsely re-match; bump avoids
    // that. Here the connection stays live, so the write must land.
    let committed: string | null = null;
    await guard.writeIfCurrent(
      "conn",
      () => Promise.resolve("value"),
      (v) => {
        committed = v;
      },
    );
    expect(committed).toBe("value");
  });

  it("clear() drops only matching keys; reset() drops all", () => {
    const guard = createRequestGuard();
    const a = guard.next("find:c1:db");
    guard.next("find:c2:db");
    guard.clear((key) => key.startsWith("find:c1:"));
    // Cleared key falls back to token 0, so the old reqId is no longer current.
    expect(guard.isCurrent("find:c1:db", a)).toBe(false);
    guard.reset();
    expect(guard.isCurrent("find:c2:db", 1)).toBe(false);
  });
});
