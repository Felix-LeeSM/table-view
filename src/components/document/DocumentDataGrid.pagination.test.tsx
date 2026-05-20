import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DocumentDataGrid from "./DocumentDataGrid";
import { __resetDocumentStoreForTests } from "@/test-utils/documentStore";
import type { DocumentQueryResult } from "@/types/document";

// Sprint 117 — DocumentDataGrid 페이지네이션이 RDB DataGrid 와 동일한
// First/Prev/Jump/Next/Last + size select 면을 노출하는지 회귀 방지.
//
// DocumentDataGrid 는 sprint 87 에서 DataGridToolbar 를 공유 마운트하도록
// 정렬됐고, sprint 112 에서 size select 가 Radix Select 로 정규화됨. 본
// 테스트 파일은 그 정렬 사실 자체를 단언해 미래에 doc/RDB toolbar 가
// 분기되면 즉시 깨지도록 한다.

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
  // AC-01: 5 페이지네이션 컨트롤 + size select trigger 가 RDB DataGrid 와
  // 동일한 aria-label 로 노출.
  it("renders First / Previous / Jump / Next / Last + Page size controls", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("User 0")).toBeInTheDocument());

    // 5 개 컨트롤 모두 존재. wording 은 RDB DataGridToolbar 와 1:1 일치.
    expect(screen.getByLabelText("First page")).toBeInTheDocument();
    expect(screen.getByLabelText("Previous page")).toBeInTheDocument();
    expect(screen.getByLabelText("Jump to page")).toBeInTheDocument();
    expect(screen.getByLabelText("Next page")).toBeInTheDocument();
    expect(screen.getByLabelText("Last page")).toBeInTheDocument();
    // Size select trigger (Radix Select). Sprint 112 정규화의 회귀 방지.
    expect(screen.getByLabelText("Page size")).toBeInTheDocument();
  });

  // AC-02 (Sprint 289 rewrite): 유효한 Jump 입력 → Enter / blur commit
  // 시점에 page fetch (skip = (page-1) * pageSize). 종전 (sprint 117)
  // 까지는 onChange 가 매 키 입력마다 fetch 했지만 Sprint 289 부터는
  // draft state + Enter/blur commit. fireEvent.change 만으론 fetch 가
  // 일어나지 않아야 하고, Enter 키 입력 시점에 발화한다.
  it("Jump input dispatches a fetch with the correct skip on Enter commit", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("User 0")).toBeInTheDocument());
    const initialCalls = findMock.mock.calls.length;

    const jump = screen.getByLabelText("Jump to page") as HTMLInputElement;
    fireEvent.change(jump, { target: { value: "2" } });

    // 타이핑만으로는 fetch 가 발생하지 않아야 한다.
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

  // AC-02 negative (Sprint 289 rewrite): out-of-range Jump (빈 문자열 /
  // 음수 / 0 / totalPages 초과) 를 입력하고 Enter / blur 로 commit 해도
  // PageJumpInput 의 가드 (`val >= 1 && val <= totalPages`) 가 막아
  // fetch 가 발화되지 않아야 한다. 잘못된 값은 외부 page 로 revert.
  it("Jump input ignores out-of-range and empty values on commit", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("User 0")).toBeInTheDocument());
    const baselineCalls = findMock.mock.calls.length;

    const jump = screen.getByLabelText("Jump to page") as HTMLInputElement;
    // totalPages = 3. "" / 4 / 0 / -1 모두 commit 시 가드에 막혀야 함.
    for (const bad of ["", "4", "0", "-1"]) {
      fireEvent.change(jump, { target: { value: bad } });
      fireEvent.keyDown(jump, { key: "Enter" });
    }

    await waitFor(() => expect(findMock.mock.calls.length).toBe(baselineCalls));
  });

  // AC-01: Last/First 버튼 클릭 경로 확인. RDB 와 동일하게 첫 / 마지막
  // 페이지로 점프해 새 fetch 가 일어남.
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

  // AC-03: Page size select 가 native <select> 가 아닌 Radix Select 임을
  // trigger 클릭 → role="option" 노출로 단언. sprint 112 정규화의 회귀
  // 방지.
  it("Page size uses the design-system Select (sprint 112 normalize)", async () => {
    const user = userEvent.setup();
    renderGrid();

    await waitFor(() => expect(screen.getByText("User 0")).toBeInTheDocument());

    // Radix Select 의 trigger 는 button + aria-label="Page size".
    const trigger = screen.getByLabelText("Page size");
    expect(trigger.tagName).toBe("BUTTON");

    // native <select> 가 아님을 직접 확인.
    expect(document.querySelector("select")).toBeNull();

    await user.click(trigger);

    // Radix portal 에 option 들이 마운트.
    const options = await screen.findAllByRole("option");
    expect(options.length).toBeGreaterThanOrEqual(4); // 100 / 300 / 500 / 1000.
    const labels = options.map((o) => o.textContent?.trim());
    expect(labels).toEqual(
      expect.arrayContaining(["100", "300", "500", "1000"]),
    );
  });
});
