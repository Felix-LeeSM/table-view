/**
 * Issue #1369 — the unmount-safe clipboard state machine extracted from
 * PreviewCopyButton (sprint-252) into a shared hook. Covers the success /
 * failure transient windows, multi-key targeting (password vs json), and
 * the unmount timer cleanup that keeps a late revert from setState-ing a
 * dead component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCopyToClipboard } from "./useCopyToClipboard";

function installClipboard(impl: (text: string) => Promise<void>) {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("useCopyToClipboard", () => {
  it("writes the text and flips to success then reverts after successMs", async () => {
    const writeText = installClipboard(() => Promise.resolve());
    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copy("payload");
    });

    expect(writeText).toHaveBeenCalledWith("payload");
    expect(result.current.copied).toBe(true);
    expect(result.current.status).toBe("success");

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(result.current.copied).toBe(false);
    expect(result.current.status).toBe("idle");
  });

  it("surfaces failure and logs when the carrier rejects", async () => {
    installClipboard(() => Promise.reject(new Error("denied")));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copy("x");
    });

    expect(result.current.status).toBe("failure");
    expect(result.current.copied).toBe(false);
    expect(errSpy).toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(result.current.status).toBe("idle");
    errSpy.mockRestore();
  });

  it("surfaces failure when the clipboard carrier is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copy("x");
    });

    expect(result.current.status).toBe("failure");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("tracks which key was copied for multi-button callers", async () => {
    installClipboard(() => Promise.resolve());
    const { result } = renderHook(() =>
      useCopyToClipboard<"password" | "json">(),
    );

    await act(async () => {
      await result.current.copy("secret", "password");
    });
    expect(result.current.copiedKey).toBe("password");

    await act(async () => {
      await result.current.copy("{}", "json");
    });
    expect(result.current.copiedKey).toBe("json");
  });

  it("does not setState after unmount when the timer fires late", async () => {
    installClipboard(() => Promise.resolve());
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copy("payload");
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(2500);
    });

    const warnings = errSpy.mock.calls
      .flat()
      .filter(
        (a) => typeof a === "string" && a.includes("unmounted component"),
      );
    expect(warnings.length).toBe(0);
    errSpy.mockRestore();
  });
});
