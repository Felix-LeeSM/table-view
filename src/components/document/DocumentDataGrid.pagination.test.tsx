import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDocumentStoreForTests } from "@/test-utils/documentStore";
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { DocumentQueryResult } from "@/types/document";
import DocumentDataGrid from "./DocumentDataGrid";

// Regression guard: DocumentDataGrid pagination exposes the same
// First/Prev/Jump/Next/Last + size select surface as the RDB DataGrid.
//
// DocumentDataGrid mounts the shared DataGridToolbar, and its size select
// is normalised to a Radix Select. This file asserts that alignment
// itself, so it breaks the moment the doc/RDB toolbars diverge.

function buildPagedResult(
  page: number,
  pageSize: number,
  totalCount: number,
): DocumentQueryResult {
  const startId = (page - 1) * pageSize;
  const rowCount = Math.min(pageSize, Math.max(0, totalCount - startId));
  const rows: unknown[][] = Array.from({ length: rowCount }, (_, i) => [
    {
      $oid: `65abcdef0000000000000${(startId + i).toString().padStart(3, "0")}`,
    },
    `User ${startId + i}`,
  ]);
  return {
    columns: [
      { name: "_id", dataType: "ObjectId", category: "unknown" },
      { name: "name", dataType: "string", category: "unknown" },
    ],
    rows,
    rawDocuments: rows.map((r) => ({ _id: r[0], name: r[1] })),
    totalCount: totalCount,
    executionTimeMs: 1,
  };
}

const findMock =
  vi.fn<
    (
      ...args: [string, string, string, unknown?]
    ) => Promise<DocumentQueryResult>
  >();
beforeEach(() => {
  setupTauriMock({
    listMongoDatabases: vi.fn(() => Promise.resolve([])),
    listMongoCollections: vi.fn(() => Promise.resolve([])),
    inferCollectionFields: vi.fn(() => Promise.resolve([])),
    findDocuments: (...args: [string, string, string, unknown?]) =>
      findMock(...args),
    insertDocument: vi.fn(() => Promise.resolve({})),
    updateDocument: vi.fn(() => Promise.resolve()),
    deleteDocument: vi.fn(() => Promise.resolve()),
  });
});

beforeEach(() => {
  __resetDocumentStoreForTests();
  findMock.mockReset();
  // Default: 601 docs / pageSize 300 → totalPages = 3.
  findMock.mockImplementation(
    async (_c: string, _db: string, _col: string, body?: unknown) => {
      const b = body as { skip?: number; limit?: number } | undefined;
      const skip = b?.skip ?? 0;
      const limit = b?.limit ?? 300;
      const page = Math.floor(skip / limit) + 1;
      return buildPagedResult(page, limit, 601);
    },
  );
});

function renderGrid() {
  return render(
    <DocumentDataGrid
      connectionId="conn-mongo"
      database="table_view_test"
      collection="users"
    />,
  );
}

describe("DocumentDataGrid — pagination parity (sprint 117)", () => {
  // AC-01: the 5 pagination controls + the size select trigger expose the
  // same aria-labels as the RDB DataGrid.
  it("renders First / Previous / Jump / Next / Last + Page size controls", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("User 0")).toBeInTheDocument());

    // All 5 controls present. Wording matches the RDB DataGridToolbar 1:1.
    expect(screen.getByLabelText("First page")).toBeInTheDocument();
    expect(screen.getByLabelText("Previous page")).toBeInTheDocument();
    expect(screen.getByLabelText("Jump to page")).toBeInTheDocument();
    expect(screen.getByLabelText("Next page")).toBeInTheDocument();
    expect(screen.getByLabelText("Last page")).toBeInTheDocument();
    // Size select trigger (Radix Select). Guards the Radix normalise.
    expect(screen.getByLabelText("Page size")).toBeInTheDocument();
  });

  // AC-02: a valid Jump input fetches the page at Enter / blur commit
  // (skip = (page-1) * pageSize). The input holds draft state and commits
  // on Enter/blur, so `fireEvent.change` alone must not fetch; the Enter
  // keypress fires it.
  it("Jump input dispatches a fetch with the correct skip on Enter commit", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("User 0")).toBeInTheDocument());
    const initialCalls = findMock.mock.calls.length;

    const jump = screen.getByLabelText("Jump to page") as HTMLInputElement;
    fireEvent.change(jump, { target: { value: "2" } });

    // Typing alone must not trigger a fetch.
    expect(findMock.mock.calls.length).toBe(initialCalls);

    fireEvent.keyDown(jump, { key: "Enter" });

    await waitFor(() => {
      expect(findMock.mock.calls.length).toBeGreaterThan(initialCalls);
    });
    const lastCall = findMock.mock.calls[findMock.mock.calls.length - 1]!;
    const body = lastCall[3] as { skip?: number; limit?: number };
    expect(body.skip).toBe(300);
    expect(body.limit).toBe(300);
  });

  // AC-02 negative: an out-of-range Jump (empty string / negative / 0 /
  // above totalPages) committed with Enter / blur must not fire a fetch —
  // `PageJumpInput`'s guard (`val >= 1 && val <= totalPages`) blocks it.
  // A bad value reverts to the outer page.
  it("Jump input ignores out-of-range and empty values on commit", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("User 0")).toBeInTheDocument());
    const baselineCalls = findMock.mock.calls.length;

    const jump = screen.getByLabelText("Jump to page") as HTMLInputElement;
    // totalPages = 3. "" / 4 / 0 / -1 must all be blocked by the guard
    // on commit.
    for (const bad of ["", "4", "0", "-1"]) {
      fireEvent.change(jump, { target: { value: bad } });
      fireEvent.keyDown(jump, { key: "Enter" });
    }

    await waitFor(() => expect(findMock.mock.calls.length).toBe(baselineCalls));
  });

  // AC-01: the Last/First button click path. As in the RDB grid, it jumps
  // to the first / last page and fires a new fetch.
  it("Last page button jumps to the final page (skip = (totalPages-1) * pageSize)", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("User 0")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Last page"));

    await waitFor(() => {
      const calls = findMock.mock.calls;
      const found = calls.find((c) => {
        const body = c[3] as { skip?: number } | undefined;
        return body?.skip === 600;
      });
      expect(found).toBeDefined();
    });
  });

  // AC-03: asserts the Page size select is a Radix Select and not a native
  // <select>, by clicking the trigger and finding role="option". Guards the
  // Radix normalise.
  it("Page size uses the design-system Select (sprint 112 normalize)", async () => {
    const user = userEvent.setup();
    renderGrid();

    await waitFor(() => expect(screen.getByText("User 0")).toBeInTheDocument());

    // The Radix Select trigger is a button + aria-label="Page size".
    const trigger = screen.getByLabelText("Page size");
    expect(trigger.tagName).toBe("BUTTON");

    // Directly confirm it is not a native <select>.
    expect(document.querySelector("select")).toBeNull();

    await user.click(trigger);

    // Options mount into the Radix portal.
    const options = await screen.findAllByRole("option");
    expect(options.length).toBeGreaterThanOrEqual(4); // 100 / 300 / 500 / 1000.
    const labels = options.map((o) => o.textContent?.trim());
    expect(labels).toEqual(
      expect.arrayContaining(["100", "300", "500", "1000"]),
    );
  });
});
