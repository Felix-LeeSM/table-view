/**
 * Reason: Sprint-176 / RISK-009 — selective-attention overlay hardening
 * for the document (Mongo) grid. Mirrors the AC-176-01 negative-test
 * shape used by `DataGridTable.refetch-overlay.test.tsx` but exercises
 * `DocumentDataGrid` so the AC-176-02 guarantee — every full-bleed
 * overlay surfaced by the audit — is locked in code, not just docs.
 *
 * NOTE on test mechanism (sprint-176 attempt 2 — Evaluator findings F-1
 * and F-2): the load-bearing assertion is `event.defaultPrevented ===
 * true`, which proves the overlay's React `onMouseDown` /
 * `onClick` / `onDoubleClick` / `onContextMenu` handlers actually
 * executed `e.preventDefault()`. In jsdom the overlay <div> is a sibling
 * of <table>, so a `fireEvent.click(overlay)` does not bubble to a
 * <tr>; the previous attempt 1 assertion `expect(spy).not.toHaveBeenCalled()`
 * was therefore vacuous. Secondary user-visible checks
 * (aria-selected unchanged, no inline editor mounted) are kept as
 * informative assertions but are not what proves the production
 * handlers ran. Attempt 2 also adds the missing mouseDown +
 * contextmenu coverage (F-2).
 *
 * Date: 2026-04-30 (sprint-176, generator phase — attempt 2)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  createEvent,
} from "@testing-library/react";
import DocumentDataGrid from "./DocumentDataGrid";
import { __resetDocumentStoreForTests } from "@stores/documentStore";
import type { DocumentQueryResult } from "@/types/document";

// Programmable resolver so we can keep `runFind` pending mid-test, then
// resolve on demand. Pending state is the only way to surface the refetch
// overlay (loading=true while data is already populated from a prior
// resolve).
let pendingResolver: ((value: DocumentQueryResult) => void) | null = null;

function buildResult(
  overrides: Partial<DocumentQueryResult> = {},
): DocumentQueryResult {
  return {
    columns: [
      { name: "_id", data_type: "ObjectId" },
      { name: "name", data_type: "string" },
    ],
    rows: [
      [{ $oid: "65abcdef0123456789abcdef" }, "Alice"],
      [{ $oid: "65abcdef0123456789abcde0" }, "Bob"],
    ],
    raw_documents: [
      {
        _id: { $oid: "65abcdef0123456789abcdef" },
        name: "Alice",
      },
      {
        _id: { $oid: "65abcdef0123456789abcde0" },
        name: "Bob",
      },
    ],
    total_count: 2,
    execution_time_ms: 3,
    ...overrides,
  };
}

const findMock =
  vi.fn<
    (
      ...args: [string, string, string, unknown?]
    ) => Promise<DocumentQueryResult>
  >();

vi.mock("@lib/tauri", () => ({
  listMongoDatabases: vi.fn(() => Promise.resolve([])),
  listMongoCollections: vi.fn(() => Promise.resolve([])),
  inferCollectionFields: vi.fn(() => Promise.resolve([])),
  findDocuments: (...args: [string, string, string, unknown?]) =>
    findMock(...args),
  insertDocument: vi.fn(() => Promise.resolve({})),
  updateDocument: vi.fn(() => Promise.resolve()),
  deleteDocument: vi.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  __resetDocumentStoreForTests();
  findMock.mockReset();
  pendingResolver = null;
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

/**
 * Mounts DocumentDataGrid, waits for the first fetch to resolve, then
 * triggers a second fetch (page-forward) that hangs forever. Returns the
 * overlay element once it appears. The second-fetch hang is the only way
 * to reach the refetch state (loading=true + data already rendered).
 */
async function enterRefetchState(): Promise<HTMLElement> {
  findMock
    .mockResolvedValueOnce(buildResult({ total_count: 301 }))
    .mockImplementationOnce(
      () =>
        new Promise<DocumentQueryResult>((resolve) => {
          pendingResolver = resolve;
        }),
    );

  renderGrid();
  await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
  fireEvent.click(screen.getByLabelText("Next page"));
  return screen.findByRole("status", { name: "Loading" });
}

describe("DocumentDataGrid refetch overlay (sprint-176)", () => {
  // Reason: AC-176-02 — overlay's mouseDown handler must call
  // preventDefault. Mirrors the DataGridTable mouseDown gesture (added
  // per Evaluator F-2: attempt 1 omitted mouseDown on DocumentDataGrid).
  // Date: 2026-04-30 (sprint-176 attempt 2 — F-1, F-2)
  it("[AC-176-02] overlay blocks mouseDown from reaching row", async () => {
    const overlay = await enterRefetchState();

    const event = createEvent.mouseDown(overlay);
    fireEvent(overlay, event);

    expect(event.defaultPrevented).toBe(true);

    // Resolve the hanging fetch so React Testing Library doesn't warn
    // about pending state at teardown.
    pendingResolver?.(buildResult({ total_count: 301 }));
  });

  // Reason: AC-176-02 — same negative-test guarantee as DataGridTable but
  // for the document grid. Load-bearing assertion: defaultPrevented true.
  // Secondary check: aria-selected on the row stays "false". Replaces
  // the attempt-1 vacuous `expect(...).toHaveAttribute("aria-selected",
  // "false")` after fireEvent.click(overlay), which would have passed
  // even if the production handler were stripped.
  // Date: 2026-04-30 (sprint-176 attempt 2 — F-1)
  it("[AC-176-02] overlay blocks click on rows during refetch", async () => {
    const overlay = await enterRefetchState();

    // Spy on the row's onClick: in DocumentDataGrid the row click triggers
    // selection by toggling aria-selected. If the overlay swallows the
    // gesture, the row's aria-selected stays "false".
    const rowAlice = screen.getByText("Alice").closest("tr") as HTMLElement;
    expect(rowAlice).toHaveAttribute("aria-selected", "false");

    const event = createEvent.click(overlay);
    fireEvent(overlay, event);

    // Load-bearing assertion: production onClick handler ran and called
    // preventDefault. This catches a regression even though click on
    // overlay can't bubble to <tr> in jsdom.
    expect(event.defaultPrevented).toBe(true);
    // Secondary user-visible invariant.
    expect(rowAlice).toHaveAttribute("aria-selected", "false");

    pendingResolver?.(buildResult({ total_count: 301 }));
  });

  // Reason: AC-176-02 — double-click on the overlay must not open the
  // inline editor on the cell underneath. DocumentDataGrid treats
  // dblclick on a scalar cell as the cell-edit entry gesture; pre-176
  // the bg-background/60 backdrop didn't intercept the gesture.
  // Date: 2026-04-30 (sprint-176 attempt 2 — F-1)
  it("[AC-176-02] overlay blocks doubleClick from opening cell editor", async () => {
    const overlay = await enterRefetchState();

    const event = createEvent.dblClick(overlay);
    fireEvent(overlay, event);

    expect(event.defaultPrevented).toBe(true);
    // No inline editor was opened — the input that double-click would
    // surface is absent.
    expect(screen.queryByLabelText(/Editing /)).not.toBeInTheDocument();

    pendingResolver?.(buildResult({ total_count: 301 }));
  });

  // Reason: AC-176-02 — right-click on the overlay must not open a
  // context menu on the row underneath. Added per Evaluator F-2:
  // attempt 1 omitted contextmenu coverage on DocumentDataGrid.
  // Date: 2026-04-30 (sprint-176 attempt 2 — F-2)
  it("[AC-176-02] overlay blocks contextmenu from opening menu", async () => {
    const overlay = await enterRefetchState();

    const event = createEvent.contextMenu(overlay);
    fireEvent(overlay, event);

    expect(event.defaultPrevented).toBe(true);
    // No context menu portal mounted.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    pendingResolver?.(buildResult({ total_count: 301 }));
  });

  // Reason: AC-176-04 — spinner visuals on DocumentDataGrid match the
  // pre-176 implementation (same wrapper classes, same Loader2 size and
  // colour). DOM-class assertion is sufficient — see findings.md
  // §Mechanism Note for the AC-176-04 justification. Attempt 2 also
  // pins `aria-hidden="true"` on the SVG (Evaluator F-5).
  // Date: 2026-04-30 (sprint-176 attempt 2 — F-5)
  it("[AC-176-04] spinner DOM (classes, size, position) is unchanged", async () => {
    const overlay = await enterRefetchState();

    expect(overlay).toHaveClass(
      "absolute",
      "inset-0",
      "z-20",
      "flex",
      "items-center",
      "justify-center",
      "bg-background/60",
    );
    const spinner = overlay.querySelector("svg.animate-spin");
    expect(spinner).not.toBeNull();
    expect(spinner).toHaveClass("animate-spin", "text-muted-foreground");
    expect(spinner).toHaveAttribute("width", "24");
    expect(spinner).toHaveAttribute("height", "24");
    // a11y polish (attempt 2): SVG is decorative; assistive tech reads
    // the wrapper's aria-label instead.
    expect(spinner).toHaveAttribute("aria-hidden", "true");

    pendingResolver?.(buildResult({ total_count: 301 }));
  });
});
