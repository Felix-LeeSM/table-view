// 2026-05-09 — new PreviewDialog Copy button.
//
// Why: the last seam of the ADR 0022 Phase 5 polish series — an affordance
// that lets the user copy the SQL/MQL body out right before commit. The
// Copy button sits at the right of the header (so read-only viewers without
// a footer can use it too), uses `data-testid="preview-dialog-copy"`, calls
// the `navigator.clipboard.writeText` carrier, shows transient "Copied" /
// "Copy failed" dialog-local feedback, and clears its timer on unmount.
//
// /tdd flow: this file was written before the implementation (red), then
// PreviewDialog's `copyText` / `copyAriaLabel` props + internal state
// machine were implemented (green).
//
// Maps:
// - AC-252-01 → "Copy button render + testid + aria-label"
// - AC-252-02 → "carrier called once + arg matches"
// - AC-252-03 → "success path → Copied label",
//   "failure path → Copy failed label"
// - AC-252-04 → "trim → empty string → not rendered"
// - extra regression → "setTimeout cleanup on unmount (no warning)"

import PreviewDialog from "@components/ui/dialog/PreviewDialog";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Helper — install a controllable clipboard carrier on `navigator.clipboard`.
// jsdom doesn't ship `navigator.clipboard`, so we define it before each test.
function installClipboard(impl: (text: string) => Promise<void>) {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe("PreviewDialog Copy button (sprint-252)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Tear down the navigator.clipboard stub between tests.
    // `Object.defineProperty` with `configurable: true` allows redefinition.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });

  it("AC-252-01: renders Copy button with testid + aria-label when copyText is non-empty", () => {
    installClipboard(() => Promise.resolve());
    render(
      <PreviewDialog
        title="Review SQL"
        preview={<pre>SELECT 1</pre>}
        onCancel={vi.fn()}
        copyText="SELECT 1"
      />,
    );

    const btn = screen.getByTestId("preview-dialog-copy");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-label", "Copy");
  });

  it("AC-252-01: copyAriaLabel overrides default aria-label", () => {
    installClipboard(() => Promise.resolve());
    render(
      <PreviewDialog
        title="Review SQL"
        preview={<pre>SELECT 1</pre>}
        onCancel={vi.fn()}
        copyText="SELECT 1"
        copyAriaLabel="Copy SQL to clipboard"
      />,
    );

    const btn = screen.getByTestId("preview-dialog-copy");
    expect(btn).toHaveAttribute("aria-label", "Copy SQL to clipboard");
  });

  it("AC-252-02: clicking Copy invokes navigator.clipboard.writeText with copyText exactly once", async () => {
    const writeText = installClipboard(() => Promise.resolve());
    render(
      <PreviewDialog
        title="Review SQL"
        preview={<pre>SELECT * FROM users</pre>}
        onCancel={vi.fn()}
        copyText="SELECT * FROM users"
      />,
    );

    const btn = screen.getByTestId("preview-dialog-copy");
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("SELECT * FROM users");
  });

  it("AC-252-03 success: shows transient 'Copied' label after success then reverts", async () => {
    installClipboard(() => Promise.resolve());
    render(
      <PreviewDialog
        title="Review SQL"
        preview={<pre>SELECT 1</pre>}
        onCancel={vi.fn()}
        copyText="SELECT 1"
      />,
    );

    const btn = screen.getByTestId("preview-dialog-copy");
    expect(btn.textContent).toContain("Copy");
    expect(btn.textContent).not.toContain("Copied");

    await act(async () => {
      fireEvent.click(btn);
      // Resolve the writeText promise microtask.
      await Promise.resolve();
    });

    expect(btn.textContent).toContain("Copied");

    // Advance past the 1500ms transient window.
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });

    expect(btn.textContent).not.toContain("Copied");
    expect(btn.textContent).toContain("Copy");
  });

  it("AC-252-03 failure: shows transient 'Copy failed' label and logs console.error on reject", async () => {
    installClipboard(() => Promise.reject(new Error("denied")));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <PreviewDialog
        title="Review SQL"
        preview={<pre>SELECT 1</pre>}
        onCancel={vi.fn()}
        copyText="SELECT 1"
      />,
    );

    const btn = screen.getByTestId("preview-dialog-copy");
    await act(async () => {
      fireEvent.click(btn);
      // Flush the rejection chain.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(btn.textContent).toContain("Copy failed");
    expect(errSpy).toHaveBeenCalled();

    // Advance past the 2000ms transient window.
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(btn.textContent).not.toContain("Copy failed");
    expect(btn.textContent).toContain("Copy");

    errSpy.mockRestore();
  });

  it("AC-252-04: empty copyText → button NOT rendered", () => {
    installClipboard(() => Promise.resolve());
    render(
      <PreviewDialog
        title="Empty"
        preview={<pre />}
        onCancel={vi.fn()}
        copyText=""
      />,
    );
    expect(screen.queryByTestId("preview-dialog-copy")).toBeNull();
  });

  it("AC-252-04: whitespace-only copyText → button NOT rendered", () => {
    installClipboard(() => Promise.resolve());
    render(
      <PreviewDialog
        title="Empty"
        preview={<pre />}
        onCancel={vi.fn()}
        copyText={"   \n\t  "}
      />,
    );
    expect(screen.queryByTestId("preview-dialog-copy")).toBeNull();
  });

  it("AC-252-04: copyText omitted entirely → button NOT rendered (preserves byte-identical render for existing 8 callers)", () => {
    render(
      <PreviewDialog
        title="No copy"
        preview={<pre>body</pre>}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("preview-dialog-copy")).toBeNull();
  });

  it("unmount during transient 'Copied' label clears pending timer (no setState on unmounted)", async () => {
    installClipboard(() => Promise.resolve());
    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(
      <PreviewDialog
        title="Review SQL"
        preview={<pre>SELECT 1</pre>}
        onCancel={vi.fn()}
        copyText="SELECT 1"
      />,
    );

    const btn = screen.getByTestId("preview-dialog-copy");
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });
    expect(btn.textContent).toContain("Copied");

    unmount();

    // Advance past the transient window — if cleanup fired correctly the
    // setTimeout callback is canceled and React does not warn about
    // "Cannot perform a React state update on an unmounted component".
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    // React 18 surfaces unmount-state warnings through console.error.
    const warnings = warnSpy.mock.calls.flat().filter((arg) => {
      if (typeof arg !== "string") return false;
      return arg.includes("unmounted component");
    });
    expect(warnings.length).toBe(0);

    warnSpy.mockRestore();
  });
});
