import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import KvKeyDetailPanel from "./KvKeyDetailPanel";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import type { ConnectionConfig } from "@/types/connection";
import type { KvKeyType, KvValue, KvValueEnvelope } from "@/types/kv";

// Purpose: Redis collection types (hash/list/set/zSet) render as structured
// tables in the KV key detail panel instead of the degraded flattened <pre>
// body (#1465, read-only axis of #1415, 2026-07-11). string/json keep the raw
// body.

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function redisConnection(): ConnectionConfig {
  return {
    id: "redis-1",
    name: "Redis",
    dbType: "redis",
    host: "localhost",
    port: 6379,
    user: "",
    database: "0",
    groupId: null,
    color: null,
    hasPassword: false,
    paradigm: "kv",
  };
}

function envelope(
  keyType: KvKeyType,
  value: KvValue,
  length?: number,
): KvValueEnvelope {
  return {
    key: "k:1",
    metadata: { key: "k:1", keyType, ttl: { state: "persistent" }, length },
    value,
  };
}

function renderPanel() {
  return render(
    <KvKeyDetailPanel connectionId="redis-1" database={0} keyName="k:1" />,
  );
}

describe("KvKeyDetailPanel collection rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      connections: [redisConnection()],
      activeStatuses: { "redis-1": { type: "connected", activeDb: "0" } },
    });
    useSafeModeStore.setState({ mode: "strict" });
  });

  // Reason: hash keys must render one row per field with Field/Value columns —
  // the structured view users lose in the flattened <pre> body.
  it("renders a hash as a field/value table", async () => {
    invokeMock.mockResolvedValue(
      envelope("hash", {
        type: "hash",
        fields: [
          { field: "name", value: "Ada" },
          { field: "email", value: "ada@example.com" },
        ],
        cursor: "0",
        nextCursor: "0",
        done: true,
        total: 2,
      }),
    );

    renderPanel();

    const table = await screen.findByRole("table", { name: /k:1 hash/i });
    expect(
      within(table).getByRole("columnheader", { name: "Field" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: "Value" }),
    ).toBeInTheDocument();
    const row = within(table).getByRole("row", { name: /name Ada/ });
    expect(within(row).getByRole("cell", { name: "name" })).toBeInTheDocument();
    expect(within(row).getByRole("cell", { name: "Ada" })).toBeInTheDocument();
    expect(
      within(table).getByRole("cell", { name: "ada@example.com" }),
    ).toBeInTheDocument();
  });

  // Reason: list keys must keep element order visible via an Index column.
  it("renders a list as an index/value table", async () => {
    invokeMock.mockResolvedValue(
      envelope("list", {
        type: "list",
        entries: [
          { index: 0, value: "alpha" },
          { index: 1, value: "beta" },
        ],
        total: 2,
      }),
    );

    renderPanel();

    const table = await screen.findByRole("table", { name: /k:1 list/i });
    expect(
      within(table).getByRole("columnheader", { name: "Index" }),
    ).toBeInTheDocument();
    const row = within(table).getByRole("row", { name: /1 beta/ });
    expect(within(row).getByRole("cell", { name: "1" })).toBeInTheDocument();
    expect(within(row).getByRole("cell", { name: "beta" })).toBeInTheDocument();
  });

  // Reason: set keys must render one member per row under a Member column.
  it("renders a set as a member table", async () => {
    invokeMock.mockResolvedValue(
      envelope("set", {
        type: "set",
        members: ["alpha", "beta"],
        cursor: "0",
        nextCursor: "0",
        done: true,
        total: 2,
      }),
    );

    renderPanel();

    const table = await screen.findByRole("table", { name: /k:1 set/i });
    expect(
      within(table).getByRole("columnheader", { name: "Member" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("cell", { name: "alpha" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("cell", { name: "beta" }),
    ).toBeInTheDocument();
  });

  // Reason: zSet keys must pair each member with its score.
  it("renders a zSet as a member/score table", async () => {
    invokeMock.mockResolvedValue(
      envelope("zSet", {
        type: "zSet",
        entries: [
          { member: "alpha", score: 1.5 },
          { member: "beta", score: -2 },
        ],
        total: 2,
      }),
    );

    renderPanel();

    const table = await screen.findByRole("table", { name: /k:1 zSet/i });
    expect(
      within(table).getByRole("columnheader", { name: "Score" }),
    ).toBeInTheDocument();
    const row = within(table).getByRole("row", { name: /alpha 1\.5/ });
    expect(
      within(row).getByRole("cell", { name: "alpha" }),
    ).toBeInTheDocument();
    expect(within(row).getByRole("cell", { name: "1.5" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "-2" })).toBeInTheDocument();
  });

  // Reason: large collections arrive pre-bounded by the backend read limit —
  // the panel must render only the delivered page and disclose truncation
  // instead of pretending the page is the whole collection (AC: 10k+ no hang).
  it("renders only the bounded page of a large collection with a truncation notice", async () => {
    const fields = Array.from({ length: 100 }, (_, i) => ({
      field: `f${i}`,
      value: `v${i}`,
    }));
    invokeMock.mockResolvedValue(
      envelope(
        "hash",
        {
          type: "hash",
          fields,
          cursor: "0",
          nextCursor: "1024",
          done: false,
          total: 12000,
        },
        12000,
      ),
    );

    renderPanel();

    const table = await screen.findByRole("table", { name: /k:1 hash/i });
    // 100 entry rows + 1 header row — never the full 12k collection.
    expect(within(table).getAllByRole("row")).toHaveLength(101);
    expect(
      screen.getByText(/Showing first 100 of 12K entries/),
    ).toBeInTheDocument();
  });

  // Reason: an empty collection page must say so, not show a blank table body.
  it("shows an empty state for a collection without entries", async () => {
    invokeMock.mockResolvedValue(
      envelope("set", {
        type: "set",
        members: [],
        cursor: "0",
        nextCursor: "0",
        done: true,
        total: 0,
      }),
    );

    renderPanel();

    const table = await screen.findByRole("table", { name: /k:1 set/i });
    expect(
      within(table).getByRole("cell", { name: "No entries." }),
    ).toBeInTheDocument();
  });

  // Reason: string keys must keep the existing raw body render (regression
  // guard for the non-collection path).
  it("keeps the raw body render for string values", async () => {
    invokeMock.mockResolvedValue(
      envelope("string", {
        type: "string",
        encoding: "utf8",
        text: "plain text value",
        byteLength: 16,
      }),
    );

    renderPanel();

    // The value shows in the raw <pre> body (the mutation textarea also echoes
    // it, hence findAllByText).
    const matches = await screen.findAllByText("plain text value");
    expect(matches.some((el) => el.tagName === "PRE")).toBe(true);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  // Reason: json keys must keep the pretty-printed body (regression guard).
  it("keeps the pretty-printed body render for json values", async () => {
    invokeMock.mockResolvedValue(
      envelope("json", { type: "json", value: { plan: "pro" } }),
    );

    renderPanel();

    expect(await screen.findByText(/"plan": "pro"/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
