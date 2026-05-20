// Sprint 248 (ADR 0022 Phase 4) — `QueryResultGrid` dry-run banner.
// Pinned to the contract `[AC-248-B1]` (banner mounts when `isDryRun=true`)
// and `[AC-248-B2]` (banner absent otherwise). date 2026-05-09.
//
// We assert against the `data-testid="dry-run-banner"` carrier so the
// test stays resilient to color-token / copy iteration; the user-facing
// copy ("Dry Run — rolled back. No data was changed.") is asserted as
// well so accidental wording drift is caught here, not at QA time.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import QueryResultGrid from "./QueryResultGrid";
import type { QueryResult } from "@/types/query";

const DML_RESULT: QueryResult = {
  columns: [],
  rows: [],
  totalCount: 0,
  executionTimeMs: 4,
  queryType: { dml: { rows_affected: 3 } },
};

describe("QueryResultGrid — dry-run banner (Sprint 248)", () => {
  // [AC-248-B1] queryState.isDryRun=true → banner mounted with copy.
  it("[AC-248-B1] renders banner when queryState.completed.isDryRun=true", () => {
    render(
      <QueryResultGrid
        queryState={{
          status: "completed",
          result: DML_RESULT,
          isDryRun: true,
        }}
      />,
    );
    const banner = screen.getByTestId("dry-run-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveTextContent(
      "Dry Run — rolled back. No data was changed.",
    );
  });

  // Explicit `isDryRun` prop also surfaces the banner — covers callers
  // that wrap the grid in a custom shell (mirrors the optional-prop
  // contract from `QueryResultGridProps`).
  it("[AC-248-B1] renders banner when isDryRun prop = true (explicit)", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: DML_RESULT }}
        isDryRun
      />,
    );
    expect(screen.getByTestId("dry-run-banner")).toBeInTheDocument();
  });

  // [AC-248-B2] queryState.isDryRun=false → banner absent.
  it("[AC-248-B2] omits banner when queryState.completed.isDryRun=false", () => {
    render(
      <QueryResultGrid
        queryState={{
          status: "completed",
          result: DML_RESULT,
          isDryRun: false,
        }}
      />,
    );
    expect(screen.queryByTestId("dry-run-banner")).toBeNull();
  });

  // [AC-248-B2] queryState.isDryRun absent → banner absent (back-compat
  // with the existing `executeQuery` / `executeQueryBatch` paths that
  // never set the flag).
  it("[AC-248-B2] omits banner when isDryRun is undefined (legacy)", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: DML_RESULT }}
      />,
    );
    expect(screen.queryByTestId("dry-run-banner")).toBeNull();
  });

  // Banner must NOT render in non-completed states (idle / running /
  // error) — those branches return early before the banner code.
  it("[AC-248-B2] omits banner in error state regardless of any flag", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "error", error: "boom" }}
        isDryRun
      />,
    );
    expect(screen.queryByTestId("dry-run-banner")).toBeNull();
  });
});
