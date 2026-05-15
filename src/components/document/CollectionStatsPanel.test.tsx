// Sprint 338 (2026-05-15) — U3 live wire. Verifies CollectionStatsPanel
// dispatches collection_stats_rdb / collection_stats_mongo through
// `@/lib/api/collectionStats` wrappers and renders the result grid.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const rdbMock = vi.fn();
const mongoMock = vi.fn();

vi.mock("@/lib/api/collectionStats", () => ({
  collectionStatsRdb: (...args: unknown[]) => rdbMock(...args),
  collectionStatsMongo: (...args: unknown[]) => mongoMock(...args),
}));

import { CollectionStatsPanel } from "./CollectionStatsPanel";

const rdbStub = {
  rows: 1234,
  sizeBytes: 56789,
  indexes: 4,
  lastVacuum: "2026-05-15T00:00:00Z",
  lastAnalyze: null,
  seqScans: 10,
  idxScans: 99,
  nDead: 0,
  extras: {},
};

const mongoStub = {
  rows: 7,
  sizeBytes: 500,
  indexes: 3,
  lastVacuum: null,
  lastAnalyze: null,
  seqScans: null,
  idxScans: null,
  nDead: null,
  extras: { capped: false, avgObjSize: 71 },
};

describe("CollectionStatsPanel (Sprint 338 U3 live wire)", () => {
  beforeEach(() => {
    rdbMock.mockReset();
    mongoMock.mockReset();
  });

  it("renders RDB stats grid after collection_stats_rdb resolves", async () => {
    rdbMock.mockResolvedValueOnce(rdbStub);
    render(
      <CollectionStatsPanel
        connectionId="conn-pg"
        database="public"
        collection="users"
        paradigm="table"
      />,
    );
    expect(screen.getByTestId("collection-stats-panel")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("collection-stats-grid")).toBeInTheDocument(),
    );
    expect(rdbMock).toHaveBeenCalledWith("conn-pg", "public", "users");
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText(/2026-05-15T00:00:00Z/)).toBeInTheDocument();
  });

  it("dispatches Mongo stats on paradigm=document and renders extras", async () => {
    mongoMock.mockResolvedValueOnce(mongoStub);
    render(
      <CollectionStatsPanel
        connectionId="conn-m"
        database="app"
        collection="users"
        paradigm="document"
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("collection-stats-grid")).toBeInTheDocument(),
    );
    expect(mongoMock).toHaveBeenCalledWith("conn-m", "app", "users");
    expect(screen.getByText(/avgObjSize/)).toBeInTheDocument();
  });

  it("renders error alert when fetch rejects", async () => {
    rdbMock.mockRejectedValueOnce(new Error("permission denied"));
    render(
      <CollectionStatsPanel
        connectionId="conn-pg"
        database="public"
        collection="users"
        paradigm="table"
      />,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/permission denied/);
    expect(screen.queryByTestId("collection-stats-grid")).toBeNull();
  });

  it("re-fetches when Refresh is clicked", async () => {
    rdbMock.mockResolvedValue(rdbStub);
    const user = userEvent.setup();
    render(
      <CollectionStatsPanel
        connectionId="conn-pg"
        database="public"
        collection="users"
        paradigm="table"
      />,
    );
    await waitFor(() => expect(rdbMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId("collection-stats-refresh"));
    await waitFor(() => expect(rdbMock).toHaveBeenCalledTimes(2));
  });
});
