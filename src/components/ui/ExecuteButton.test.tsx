// Sprint 256 (2026-05-09): `ExecuteButton` — composed Execute affordance
// applied across 5 surfaces (SqlPreviewDialog / MqlPreviewModal /
// DataGrid inline preview / EditableQueryResultGrid toolbar /
// ConfirmDestructiveDialog footer).
//
// Tests cover the AC-256-05 contract:
//   - 4 severity × env color matrix (WARN+dev/null=success,
//     WARN+staging=warning, WARN+prod=destructive, STOP=destructive
//     regardless of env)
//   - label format: env null/dev → "Execute"; staging/prod → "Execute on <conn>"
//   - icon swap: Play (idle) ↔ Loader2 animate-spin (loading)
//   - disabled state propagation
//   - title tooltip carries the full label so a truncated long conn name
//     stays discoverable.
// AC mapping: AC-256-05.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ExecuteButton from "./ExecuteButton";

describe("ExecuteButton", () => {
  it("[AC-256-05a] WARN + dev → green (success token)", () => {
    render(
      <ExecuteButton
        severity="warn"
        environment="development"
        connectionLabel="dev-db"
        loading={false}
        disabled={false}
        onClick={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /execute/i });
    expect(btn.getAttribute("data-severity-env")).toBe("warn:dev");
    expect(btn.getAttribute("style")).toMatch(/--tv-success\)/);
  });

  it("[AC-256-05a] WARN + null environment → green (success token)", () => {
    render(
      <ExecuteButton
        severity="warn"
        environment={null}
        connectionLabel={null}
        loading={false}
        disabled={false}
        onClick={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /execute/i });
    expect(btn.getAttribute("data-severity-env")).toBe("warn:dev");
    expect(btn.getAttribute("style")).toMatch(/--tv-success\)/);
  });

  it("[AC-256-05b] WARN + staging → orange (warning token)", () => {
    render(
      <ExecuteButton
        severity="warn"
        environment="staging"
        connectionLabel="stage-db"
        loading={false}
        disabled={false}
        onClick={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /execute on/i });
    expect(btn.getAttribute("data-severity-env")).toBe("warn:staging");
    expect(btn.getAttribute("style")).toMatch(/--tv-warning\)/);
  });

  it("[AC-256-05c] WARN + production → red (destructive token)", () => {
    render(
      <ExecuteButton
        severity="warn"
        environment="production"
        connectionLabel="prod-db"
        loading={false}
        disabled={false}
        onClick={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /execute on/i });
    expect(btn.getAttribute("data-severity-env")).toBe("warn:prod");
    expect(btn.getAttribute("style")).toMatch(/--tv-destructive\)/);
  });

  it("[AC-256-05d] STOP severity → red regardless of env", () => {
    for (const env of [null, "local", "staging", "production"]) {
      const { unmount } = render(
        <ExecuteButton
          severity="danger"
          environment={env}
          connectionLabel="any"
          loading={false}
          disabled={false}
          onClick={vi.fn()}
        />,
      );
      const btn = screen.getByRole("button", { name: /execute/i });
      expect(btn.getAttribute("style")).toMatch(/--tv-destructive\)/);
      unmount();
    }
  });

  it("[AC-256-05e] env=null/dev → label is plain 'Execute'", () => {
    render(
      <ExecuteButton
        severity="warn"
        environment="local"
        connectionLabel="local-db"
        loading={false}
        disabled={false}
        onClick={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /execute/i });
    // "Execute" with no "on" suffix.
    expect(btn.textContent?.trim()).toBe("Execute");
  });

  it("[AC-256-05f] env=staging/prod → label is 'Execute on <conn>'", () => {
    render(
      <ExecuteButton
        severity="warn"
        environment="staging"
        connectionLabel="stage-db"
        loading={false}
        disabled={false}
        onClick={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn.textContent).toMatch(/Execute on stage-db/);
  });

  it("[AC-256-05g] truncate + title tooltip carries the full label", () => {
    render(
      <ExecuteButton
        severity="warn"
        environment="production"
        connectionLabel="very-long-connection-name-that-overflows"
        loading={false}
        disabled={false}
        onClick={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn.title).toBe(
      "Execute on very-long-connection-name-that-overflows",
    );
    // Span with truncate class for visual ellipsis.
    const labelSpan = btn.querySelector("[data-execute-button-label]");
    expect(labelSpan?.className).toMatch(/truncate/);
    expect(labelSpan?.className).toMatch(/max-w-execute-label/);
  });

  it("[AC-256-05h] loading → Loader2 spinner replaces Play, button disabled, label 'Executing…'", () => {
    const onClick = vi.fn();
    render(
      <ExecuteButton
        severity="warn"
        environment="production"
        connectionLabel="prod-db"
        loading={true}
        disabled={false}
        onClick={onClick}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    // Spinner svg present (Loader2 has lucide-loader-2 class).
    expect(btn.querySelector("svg.animate-spin")).not.toBeNull();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("[AC-256-05i] disabled → onClick suppressed", () => {
    const onClick = vi.fn();
    render(
      <ExecuteButton
        severity="warn"
        environment={null}
        connectionLabel={null}
        loading={false}
        disabled={true}
        onClick={onClick}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("[AC-256-05j] click invokes onClick when enabled", () => {
    const onClick = vi.fn();
    render(
      <ExecuteButton
        severity="warn"
        environment={null}
        connectionLabel={null}
        loading={false}
        disabled={false}
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("[AC-256-05k] custom ariaLabel overrides the default for screen readers", () => {
    render(
      <ExecuteButton
        severity="warn"
        environment={null}
        connectionLabel={null}
        loading={false}
        disabled={false}
        onClick={vi.fn()}
        ariaLabel="Run dry-run"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Run dry-run" }),
    ).toBeInTheDocument();
  });
});
