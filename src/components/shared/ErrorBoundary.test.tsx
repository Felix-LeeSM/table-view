import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Test error message");
  }
  return <div>Normal content</div>;
}

describe("ErrorBoundary", () => {
  // Suppress console.error from React error boundary logging
  const originalConsoleError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalConsoleError;
  });

  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Normal content")).toBeInTheDocument();
  });

  it("renders fallback UI when child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test error message")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("panel variant isolates the failing panel while siblings keep rendering", () => {
    // Mirrors the workspace layout: one crashing panel next to a healthy one.
    // The issue (#1312) is that a single panel throw must NOT replace the
    // whole surface — the sibling must survive.
    render(
      <div>
        <ErrorBoundary variant="panel" label="Data grid">
          <ThrowingChild shouldThrow={true} />
        </ErrorBoundary>
        <div>Sidebar still here</div>
      </div>,
    );

    // Crashed panel shows a retryable, panel-scoped fallback...
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Data grid")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    // ...and the full-screen title is NOT used (would signal a total takeover).
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
    // ...while the sibling panel is untouched.
    expect(screen.getByText("Sidebar still here")).toBeInTheDocument();
  });

  it("panel variant recovers when Retry is clicked", () => {
    const { rerender } = render(
      <ErrorBoundary variant="panel">
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

    screen.getByRole("button", { name: "Retry" }).click();
    rerender(
      <ErrorBoundary variant="panel">
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Normal content")).toBeInTheDocument();
  });

  it("recovers when Reload is clicked", async () => {
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // Click reload to clear error state
    screen.getByRole("button", { name: "Reload" }).click();

    // Rerender with non-throwing child to see recovery
    rerender(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Normal content")).toBeInTheDocument();
  });
});
