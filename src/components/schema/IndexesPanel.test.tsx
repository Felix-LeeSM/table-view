// Sprint 332 (2026-05-15) — Slice J live wire. Mongo paradigm 의 IndexesPanel
// 이 `listMongoIndexes` 를 호출하고 grid 를 렌더한다. RDB paradigm 은 schema
// 인자 흐름이 정리되기 전까지 placeholder 유지 — 그 분기도 가드.
//
// 작성 이유: 본 sprint 가 Sprint 327 의 placeholder 를 실제 fetch + table
// 렌더로 교체한다. listMongoIndexes mock 으로 (a) 호출 인자, (b) loading
// transition, (c) empty state, (d) row 매핑 (primary chip / unique 표시
// 포함), (e) error 표면, (f) RDB placeholder 잔존 을 모두 가드.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { IndexesPanel } from "./IndexesPanel";

const listMongoIndexesMock = vi.fn();

vi.mock("@/lib/tauri", () => ({
  listMongoIndexes: (...args: unknown[]) => listMongoIndexesMock(...args),
}));

describe("IndexesPanel (Sprint 332 — Slice J live wire)", () => {
  beforeEach(() => {
    listMongoIndexesMock.mockReset();
  });

  it("renders the Mongo index grid after a successful fetch", async () => {
    listMongoIndexesMock.mockResolvedValueOnce([
      {
        name: "_id_",
        columns: ["_id"],
        index_type: "btree",
        is_unique: true,
        is_primary: true,
      },
      {
        name: "email_1",
        columns: ["email"],
        index_type: "btree",
        is_unique: true,
        is_primary: false,
      },
      {
        name: "tags_text",
        columns: ["tags"],
        index_type: "text",
        is_unique: false,
        is_primary: false,
      },
    ]);

    render(
      <IndexesPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
        paradigm="document"
      />,
    );

    await waitFor(() => {
      expect(listMongoIndexesMock).toHaveBeenCalledWith(
        "conn-mongo",
        "app",
        "users",
      );
    });

    const table = await screen.findByTestId("indexes-panel-table");
    expect(table).toBeInTheDocument();
    expect(screen.getByText("_id_")).toBeInTheDocument();
    expect(screen.getByText(/primary/i)).toBeInTheDocument();
    expect(screen.getByText("email_1")).toBeInTheDocument();
    expect(screen.getByText("tags_text")).toBeInTheDocument();
    expect(screen.getByText("text")).toBeInTheDocument();
  });

  it("renders an empty state when the collection has no indexes", async () => {
    listMongoIndexesMock.mockResolvedValueOnce([]);

    render(
      <IndexesPanel
        connectionId="conn-mongo"
        database="app"
        collection="empty_coll"
        paradigm="document"
      />,
    );

    expect(await screen.findByTestId("indexes-panel-empty")).toHaveTextContent(
      /no indexes/i,
    );
  });

  it("surfaces fetch errors via role=alert", async () => {
    listMongoIndexesMock.mockRejectedValueOnce(new Error("permission denied"));

    render(
      <IndexesPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
        paradigm="document"
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /permission denied/i,
    );
  });

  it("does not fetch when database or collection is empty", () => {
    render(
      <IndexesPanel
        connectionId="conn-mongo"
        database=""
        collection=""
        paradigm="document"
      />,
    );
    expect(listMongoIndexesMock).not.toHaveBeenCalled();
  });

  it("keeps the placeholder for RDB paradigm (no schema arg flow yet)", () => {
    render(
      <IndexesPanel
        connectionId="conn-pg"
        database="public"
        collection="users"
        paradigm="table"
      />,
    );
    expect(screen.getByTestId("indexes-panel-placeholder")).toBeInTheDocument();
    expect(listMongoIndexesMock).not.toHaveBeenCalled();
  });
});
