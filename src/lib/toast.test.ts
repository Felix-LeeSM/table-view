import { describe, it, expect, beforeEach } from "vitest";
import {
  toast,
  useToastStore,
  roleForVariant,
  TOAST_DEFAULT_DURATIONS,
} from "./toast";

// Sprint 94 — toast API unit tests.
//
// Coverage targets:
//   1. Each variant helper (success/error/info/warning) pushes a toast with
//      the matching `variant` field and returns its id.
//   2. `toast.dismiss(id)` removes the matching toast from the queue.
//   3. Multiple toasts queue (FIFO insertion order preserved).
//   4. Caller-supplied id replaces an existing toast in place (update
//      semantics, no queue duplication).
//   5. `roleForVariant` maps success/info → "status", error/warning → "alert".
//   6. Variant default durations are respected when caller omits override.

describe("toast (lib)", () => {
  beforeEach(() => {
    useToastStore.getState().clear();
  });

  it("toast.success / error / info / warning push a toast with the matching variant", () => {
    const idS = toast.success("ok");
    const idE = toast.error("boom");
    const idI = toast.info("just so");
    const idW = toast.warning("careful");

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(4);
    expect(toasts.map((t) => t.variant)).toEqual([
      "success",
      "error",
      "info",
      "warning",
    ]);
    expect(toasts.map((t) => t.id)).toEqual([idS, idE, idI, idW]);
  });

  it("toast.dismiss removes the matching toast", () => {
    const id = toast.success("x");
    toast.success("y");
    expect(useToastStore.getState().toasts).toHaveLength(2);

    toast.dismiss(id);

    const remaining = useToastStore.getState().toasts;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.message).toBe("y");
  });

  it("multiple toasts queue with insertion order preserved", () => {
    toast.info("first");
    toast.info("second");
    toast.info("third");
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("caller-supplied id with collision replaces the existing toast in place", () => {
    toast.info("pending", { id: "op-1" });
    toast.success("done", { id: "op-1" });

    const queue = useToastStore.getState().toasts;
    expect(queue).toHaveLength(1);
    expect(queue[0]!.message).toBe("done");
    expect(queue[0]!.variant).toBe("success");
  });

  it("roleForVariant maps success/info → status and error/warning → alert", () => {
    expect(roleForVariant("success")).toBe("status");
    expect(roleForVariant("info")).toBe("status");
    expect(roleForVariant("error")).toBe("alert");
    expect(roleForVariant("warning")).toBe("alert");
  });

  it("variant default durations apply when caller omits durationMs", () => {
    const id = toast.success("hello");
    const t = useToastStore.getState().toasts.find((entry) => entry.id === id);
    expect(t?.durationMs).toBe(TOAST_DEFAULT_DURATIONS.success);

    const idErr = toast.error("oops");
    const tErr = useToastStore
      .getState()
      .toasts.find((entry) => entry.id === idErr);
    expect(tErr?.durationMs).toBe(TOAST_DEFAULT_DURATIONS.error);
  });

  it("durationMs override is honored, including null for sticky toasts", () => {
    toast.success("hello", { durationMs: 1234 });
    toast.error("oops", { durationMs: null });

    const queue = useToastStore.getState().toasts;
    expect(queue[0]!.durationMs).toBe(1234);
    expect(queue[1]!.durationMs).toBeNull();
  });

  it("toast.clear() empties the queue", () => {
    toast.success("a");
    toast.error("b");
    expect(useToastStore.getState().toasts).toHaveLength(2);
    toast.clear();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
