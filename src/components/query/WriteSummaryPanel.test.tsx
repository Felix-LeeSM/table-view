// Sprint 312 (Phase 28 Slice A6, 2026-05-14) — RTL coverage of the four
// `WriteSummaryPanel` variants (insert / update / delete / bulkWrite).
//
// Test axes:
//   1. insert     — headline + chevron-expandable id list
//   2. update     — "Modified N document(s) (matched M)" headline
//   3. delete     — "Deleted N document(s)" headline
//   4. bulkWrite  — table 1 row per non-zero counter + upserted ids row
//
// The panel is purely presentational — no IPC, no store reads. Tests
// pass the discriminated `WriteSummaryData` shape directly.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import WriteSummaryPanel from "./WriteSummaryPanel";
import type { WriteSummaryData } from "@/types/query";

describe("WriteSummaryPanel — insert variant", () => {
  it('renders "Inserted N document(s)" headline + chevron-expandable id list', () => {
    const summary: WriteSummaryData = {
      kind: "insert",
      insertedIds: [{ ObjectId: "507f1f77bcf86cd799439011" }, { Number: 42 }],
    };
    render(<WriteSummaryPanel summary={summary} />);
    expect(screen.getByText(/Inserted 2 document\(s\)/i)).toBeInTheDocument();

    // List is collapsed by default — chevron button visible.
    const toggle = screen.getByRole("button", {
      name: /show inserted ids/i,
    });
    expect(toggle).toBeInTheDocument();

    // Id strings are not yet rendered.
    expect(screen.queryByText(/507f1f77bcf86cd799439011/)).toBeNull();

    act(() => {
      fireEvent.click(toggle);
    });

    // After expand: every id surface (formatted via formatDocumentIdForMql).
    expect(screen.getByText(/507f1f77bcf86cd799439011/)).toBeInTheDocument();
    expect(screen.getByText(/^42$/)).toBeInTheDocument();
  });

  it("uses singular copy for exactly 1 document", () => {
    const summary: WriteSummaryData = {
      kind: "insert",
      insertedIds: [{ String: "abc" }],
    };
    render(<WriteSummaryPanel summary={summary} />);
    expect(screen.getByText("Inserted 1 document")).toBeInTheDocument();
  });

  it("renders 0 insert summary without a chevron toggle", () => {
    const summary: WriteSummaryData = { kind: "insert", insertedIds: [] };
    render(<WriteSummaryPanel summary={summary} />);
    expect(screen.getByText(/Inserted 0 document\(s\)/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /show inserted ids/i }),
    ).toBeNull();
  });
});

describe("WriteSummaryPanel — update variant", () => {
  it('renders "Modified N document(s) (matched M)" headline', () => {
    const summary: WriteSummaryData = {
      kind: "update",
      matchedCount: 5,
      modifiedCount: 3,
    };
    render(<WriteSummaryPanel summary={summary} />);
    expect(
      screen.getByText("Modified 3 document(s) (matched 5)"),
    ).toBeInTheDocument();
  });

  it("uses singular copy when matched + modified are both 1", () => {
    const summary: WriteSummaryData = {
      kind: "update",
      matchedCount: 1,
      modifiedCount: 1,
    };
    render(<WriteSummaryPanel summary={summary} />);
    expect(
      screen.getByText("Modified 1 document (matched 1)"),
    ).toBeInTheDocument();
  });
});

describe("WriteSummaryPanel — delete variant", () => {
  it('renders "Deleted N document(s)" headline', () => {
    const summary: WriteSummaryData = { kind: "delete", deletedCount: 7 };
    render(<WriteSummaryPanel summary={summary} />);
    expect(screen.getByText("Deleted 7 document(s)")).toBeInTheDocument();
  });

  it("uses singular copy for exactly 1 deleted document", () => {
    const summary: WriteSummaryData = { kind: "delete", deletedCount: 1 };
    render(<WriteSummaryPanel summary={summary} />);
    expect(screen.getByText("Deleted 1 document")).toBeInTheDocument();
  });
});

describe("WriteSummaryPanel — bulkWrite variant", () => {
  it("renders 1 table row per non-zero counter + upserted ids row", () => {
    const summary: WriteSummaryData = {
      kind: "bulkWrite",
      result: {
        inserted_count: 3,
        matched_count: 4,
        modified_count: 2,
        deleted_count: 1,
        upserted_ids: [{ ObjectId: "507f1f77bcf86cd799439011" }],
      },
    };
    render(<WriteSummaryPanel summary={summary} />);

    // Each labelled cell appears with the matching counter.
    const table = screen.getByRole("table", { name: /bulkwrite/i });
    expect(table).toBeInTheDocument();
    expect(screen.getByText(/inserted_count/i).closest("tr")).toHaveTextContent(
      "3",
    );
    expect(screen.getByText(/matched_count/i).closest("tr")).toHaveTextContent(
      "4",
    );
    expect(screen.getByText(/modified_count/i).closest("tr")).toHaveTextContent(
      "2",
    );
    expect(screen.getByText(/deleted_count/i).closest("tr")).toHaveTextContent(
      "1",
    );
    expect(screen.getByText(/upserted_ids/i).closest("tr")).toHaveTextContent(
      /507f1f77bcf86cd799439011/,
    );
  });

  it("renders an empty BulkWriteResult as all-zero counters with no upserted_ids row", () => {
    const summary: WriteSummaryData = {
      kind: "bulkWrite",
      result: {
        inserted_count: 0,
        matched_count: 0,
        modified_count: 0,
        deleted_count: 0,
        upserted_ids: [],
      },
    };
    render(<WriteSummaryPanel summary={summary} />);

    // Empty result still renders the table so users see "0 across the
    // board" instead of an ambiguous blank.
    expect(
      screen.getByRole("table", { name: /bulkwrite/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/upserted_ids/i)).toBeNull();
  });
});
