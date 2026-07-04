import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installGlobalErrorToast } from "./globalErrorToast";
import { useToastStore } from "@stores/toastStore";

// #1312 — the global safety net surfaces failures that never reach a React
// ErrorBoundary (silent async rejections, uncaught/commit-phase throws) as an
// error toast, de-duping the dev-mode double-fire.

describe("installGlobalErrorToast", () => {
  let uninstall: () => void;

  beforeEach(() => {
    useToastStore.getState().clear();
    uninstall = installGlobalErrorToast();
  });
  afterEach(() => {
    uninstall();
    vi.useRealTimers();
  });

  const errorMessages = () =>
    useToastStore
      .getState()
      .toasts.filter((t) => t.variant === "error")
      .map((t) => t.message);

  it("surfaces an unhandledrejection as an error toast", () => {
    window.dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", {
        promise: Promise.reject(new Error("boom")).catch(() => {}) as never,
        reason: new Error("boom"),
      }),
    );
    expect(errorMessages()).toHaveLength(1);
    expect(errorMessages()[0]).toContain("boom");
  });

  it("surfaces an uncaught error event", () => {
    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("commit throw") }),
    );
    expect(errorMessages()).toHaveLength(1);
    expect(errorMessages()[0]).toContain("commit throw");
  });

  it("de-dupes identical messages inside the dedupe window", () => {
    vi.useFakeTimers();
    const fire = () =>
      window.dispatchEvent(
        new ErrorEvent("error", { error: new Error("same") }),
      );
    fire();
    fire();
    expect(errorMessages()).toHaveLength(1);

    // After the dedupe window a repeat surfaces again.
    vi.advanceTimersByTime(3001);
    fire();
    expect(errorMessages()).toHaveLength(2);
  });

  it("removes both listeners on uninstall", () => {
    // Assert via spy rather than dispatching a real error post-uninstall:
    // with our listener gone, a dispatched ErrorEvent would escape to
    // vitest's own unhandled-error capture and fail the run.
    const remove = vi.spyOn(window, "removeEventListener");
    uninstall();
    const removed = remove.mock.calls.map((c) => c[0]);
    expect(removed).toContain("unhandledrejection");
    expect(removed).toContain("error");
    remove.mockRestore();
  });
});
