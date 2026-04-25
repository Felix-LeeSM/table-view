import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog";
import ConnectionDialog from "@components/connection/ConnectionDialog";
import GroupDialog from "@components/connection/GroupDialog";
import ImportExportDialog from "@components/connection/ImportExportDialog";
import BlobViewerDialog from "@components/datagrid/BlobViewerDialog";
import CellDetailDialog from "@components/datagrid/CellDetailDialog";
import SqlPreviewDialog from "@components/structure/SqlPreviewDialog";
import MqlPreviewModal from "@components/document/MqlPreviewModal";
import AddDocumentModal from "@components/document/AddDocumentModal";
import ConfirmDialog from "@components/shared/ConfirmDialog";
import { useConnectionStore } from "@stores/connectionStore";

// ---------------------------------------------------------------------------
// Sprint 91 — DialogHeader row layout + close-button parity
// ---------------------------------------------------------------------------

describe("DialogHeader (sprint-91)", () => {
  // -----------------------------------------------------------------------
  // AC-01 — row-based default layout
  // -----------------------------------------------------------------------
  it("AC-01: applies the row-based default layout", () => {
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent>
          <DialogHeader data-testid="header">
            <DialogTitle>Title</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    const header = screen.getByTestId("header");
    // Row direction so the close button sits inline with the title.
    expect(header.className).toContain("flex-row");
    expect(header.className).toContain("items-center");
    expect(header.className).toContain("justify-between");
  });

  // -----------------------------------------------------------------------
  // AC-02 — truncate-friendly: min-w-0 on header + title
  // -----------------------------------------------------------------------
  it("AC-02: header and title carry truncate-friendly min-w-0", () => {
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent>
          <DialogHeader data-testid="header">
            <DialogTitle data-testid="title" className="truncate">
              {"x".repeat(500)}
            </DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByTestId("header").className).toContain("min-w-0");
    expect(screen.getByTestId("title").className).toContain("min-w-0");
    // The caller-supplied `truncate` class should still survive merging.
    expect(screen.getByTestId("title").className).toContain("truncate");
  });

  // -----------------------------------------------------------------------
  // AC-03 — showCloseButton={false} suppresses the absolute X
  // -----------------------------------------------------------------------
  it("AC-03: showCloseButton={false} omits the absolute close button", () => {
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>No X</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    expect(document.querySelector('[data-slot="dialog-close"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });

  it("AC-03: showCloseButton default renders a single absolute X", () => {
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Default close</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    const closes = document.querySelectorAll('[data-slot="dialog-close"]');
    expect(closes).toHaveLength(1);
    const closeButtons = screen.getAllByRole("button", { name: /close/i });
    expect(closeButtons).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC-04 — close-button matrix across the 9 dialogs
//
// Each entry renders the dialog with safe defaults and asserts that no more
// than one element matches the close-button accessible name. Some dialogs
// expose 0 close buttons (ConfirmDialog uses AlertDialog without an X);
// others expose exactly 1. Crucially: never 2+.
// ---------------------------------------------------------------------------

interface MatrixCase {
  name: string;
  expectedMax: 0 | 1;
  // Render must throw if missing dependencies — hence `() => void`.
  render: () => void;
}

function setupConnectionStore() {
  useConnectionStore.setState({
    addConnection: vi
      .fn()
      .mockResolvedValue({ id: "id-1", name: "n", paradigm: "rdb" }),
    updateConnection: vi.fn().mockResolvedValue(undefined),
    testConnection: vi.fn().mockResolvedValue("ok"),
    addGroup: vi.fn().mockResolvedValue({
      id: "g-1",
      name: "g",
      color: null,
      collapsed: false,
    }),
    updateGroup: vi.fn().mockResolvedValue(undefined),
    loadConnections: vi.fn().mockResolvedValue(undefined),
    loadGroups: vi.fn().mockResolvedValue(undefined),
    connections: [],
    groups: [],
  } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);
}

const cases: MatrixCase[] = [
  {
    name: "ConnectionDialog",
    expectedMax: 1,
    render: () => {
      setupConnectionStore();
      render(<ConnectionDialog onClose={vi.fn()} />);
    },
  },
  {
    name: "GroupDialog",
    expectedMax: 0,
    render: () => {
      setupConnectionStore();
      render(<GroupDialog onClose={vi.fn()} />);
    },
  },
  {
    name: "ImportExportDialog",
    expectedMax: 1,
    render: () => {
      setupConnectionStore();
      render(<ImportExportDialog onClose={vi.fn()} />);
    },
  },
  {
    name: "BlobViewerDialog",
    expectedMax: 1,
    render: () => {
      render(
        <BlobViewerDialog
          open
          onOpenChange={vi.fn()}
          data="hello"
          columnName="col"
        />,
      );
    },
  },
  {
    name: "CellDetailDialog",
    expectedMax: 1,
    render: () => {
      render(
        <CellDetailDialog
          open
          onOpenChange={vi.fn()}
          data="hello"
          columnName="col"
          dataType="text"
        />,
      );
    },
  },
  {
    name: "SqlPreviewDialog",
    expectedMax: 1,
    render: () => {
      render(
        <SqlPreviewDialog
          sql="SELECT 1"
          loading={false}
          error={null}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    },
  },
  {
    name: "MqlPreviewModal",
    expectedMax: 1,
    render: () => {
      render(
        <MqlPreviewModal
          previewLines={["db.users.find({})"]}
          errors={[]}
          onExecute={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    },
  },
  {
    name: "AddDocumentModal",
    expectedMax: 1,
    render: () => {
      render(<AddDocumentModal onSubmit={vi.fn()} onCancel={vi.fn()} />);
    },
  },
  {
    name: "ConfirmDialog",
    expectedMax: 0,
    render: () => {
      render(
        <ConfirmDialog
          title="Delete?"
          message="Are you sure?"
          confirmLabel="Delete"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    },
  },
];

describe("close-button matrix (sprint-91 AC-04)", () => {
  it.each(cases)(
    "$name renders at most $expectedMax close buttons",
    ({ render: renderCase, expectedMax }) => {
      renderCase();
      const closes = screen.queryAllByRole("button", { name: /close/i });
      expect(closes.length).toBeLessThanOrEqual(expectedMax);
      // The Cancel buttons that some dialogs render should NEVER appear in
      // the close-button query — the regex is anchored by /close/ on the
      // accessible name, not the visible "Cancel" label. This is a sanity
      // check that the matrix actually catches duplicates.
      expect(closes.length).toBeLessThan(2);
    },
  );
});
