import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster } from "./toaster";
import { toast, useToastStore } from "@/lib/toast";

// Sprint 94 — Toaster container tests.
//
// Coverage targets the AC list in `docs/sprints/sprint-94/contract.md`:
//   AC-01: toast.success / error / info / warning render via the container.
//   AC-05: variant-specific role (status/alert), Esc key dismiss, dismiss
//          button aria-label.
//   Additional: per-variant auto-dismiss timer fires, dismiss button click
//          removes the toast, multiple toasts queue.

describe("Toaster", () => {
  beforeEach(() => {
    useToastStore.getState().clear();
  });

  afterEach(() => {
    // Restore real timers between tests so a `useFakeTimers` test doesn't
    // leak its state into a sibling test that uses real timers.
    vi.useRealTimers();
  });

  // --- AC-01: API surface renders -----------------------------------------

  it("AC-01: success/info/error/warning toasts render with the supplied message", () => {
    render(<Toaster />);

    act(() => {
      toast.success("Saved");
      toast.info("Heads up");
      toast.error("Boom");
      toast.warning("Careful");
    });

    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Heads up")).toBeInTheDocument();
    expect(screen.getByText("Boom")).toBeInTheDocument();
    expect(screen.getByText("Careful")).toBeInTheDocument();
  });

  it("AC-01: container reports a labelled landmark so assistive tech can find it", () => {
    render(<Toaster />);
    expect(screen.getByLabelText("Notifications")).toBeInTheDocument();
  });

  // --- AC-05: variant role mapping ----------------------------------------

  it("AC-05: success/info toasts use role=status, error/warning use role=alert", () => {
    render(<Toaster />);

    act(() => {
      toast.success("ok");
      toast.info("fyi");
      toast.error("oops");
      toast.warning("careful");
    });

    const statusToasts = screen.getAllByRole("status");
    // success + info both render as role=status.
    expect(statusToasts.length).toBeGreaterThanOrEqual(2);
    const statusMessages = statusToasts.map((n) => n.textContent ?? "");
    expect(statusMessages.some((m) => m.includes("ok"))).toBe(true);
    expect(statusMessages.some((m) => m.includes("fyi"))).toBe(true);

    const alertToasts = screen.getAllByRole("alert");
    expect(alertToasts.length).toBeGreaterThanOrEqual(2);
    const alertMessages = alertToasts.map((n) => n.textContent ?? "");
    expect(alertMessages.some((m) => m.includes("oops"))).toBe(true);
    expect(alertMessages.some((m) => m.includes("careful"))).toBe(true);
  });

  it("AC-05: error/warning toasts have aria-live=assertive, success/info polite", () => {
    render(<Toaster />);

    act(() => {
      toast.success("ok");
      toast.error("oops");
    });

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
  });

  // --- AC-05: dismiss button + aria-label + Esc dismiss --------------------

  it("AC-05: dismiss button has an explicit aria-label and removes the toast on click", async () => {
    const user = userEvent.setup();
    render(<Toaster />);

    act(() => {
      toast.success("Saved");
    });

    const closeButton = screen.getByRole("button", {
      name: "Dismiss notification",
    });
    expect(closeButton).toBeInTheDocument();

    await user.click(closeButton);

    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("AC-05: pressing Escape dismisses the most-recently-added toast", async () => {
    const user = userEvent.setup();
    render(<Toaster />);

    act(() => {
      toast.success("first");
      toast.error("second");
    });
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByText("second")).not.toBeInTheDocument();
    expect(screen.getByText("first")).toBeInTheDocument();
  });

  // --- Auto-dismiss + sticky timers ---------------------------------------

  it("auto-dismisses after the variant's default duration (vi.useFakeTimers)", () => {
    vi.useFakeTimers();
    render(<Toaster />);

    act(() => {
      toast.success("Saved");
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();

    // success default = 3000ms — advance well past it to fire the timeout.
    act(() => {
      vi.advanceTimersByTime(3500);
    });

    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("durationMs: null keeps the toast sticky — no auto-dismiss", () => {
    vi.useFakeTimers();
    render(<Toaster />);

    act(() => {
      toast.error("Boom", { durationMs: null });
    });

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText("Boom")).toBeInTheDocument();
  });

  // --- Queue / concurrency ------------------------------------------------

  it("multiple toasts queue and remain visible until dismissed", () => {
    render(<Toaster />);

    act(() => {
      toast.success("a");
      toast.error("b");
      toast.info("c");
    });

    const container = screen.getByLabelText("Notifications");
    expect(within(container).getByText("a")).toBeInTheDocument();
    expect(within(container).getByText("b")).toBeInTheDocument();
    expect(within(container).getByText("c")).toBeInTheDocument();
  });

  it("toast.dismiss(id) removes the matching toast from the rendered queue", () => {
    render(<Toaster />);

    let firstId: string = "";
    act(() => {
      firstId = toast.success("first");
      toast.success("second");
    });

    act(() => {
      toast.dismiss(firstId);
    });

    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  // --- AC-03: container z-index sits above modal overlay -------------------

  it("AC-03: container is positioned with z-index above modal overlay (z-100 > z-50)", () => {
    render(<Toaster />);
    const container = screen.getByLabelText("Notifications");
    // Confirm the class that pushes it above the dialog overlay.
    expect(container.className).toContain("z-100");
    // And confirm `fixed` positioning so it stays in viewport regardless of
    // ancestor scroll/transform.
    expect(container.className).toContain("fixed");
  });
});
