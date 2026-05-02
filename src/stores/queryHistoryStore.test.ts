import { describe, it, expect, beforeEach, vi } from "vitest";
import { useQueryHistoryStore } from "./queryHistoryStore";

describe("queryHistoryStore", () => {
  beforeEach(() => {
    useQueryHistoryStore.setState({
      entries: [],
      globalLog: [],
      searchFilter: "",
      connectionFilter: null,
    });
  });

  // -- Basic entries --

  describe("addHistoryEntry", () => {
    it("adds an entry to entries array", () => {
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: "SELECT 1",
        executedAt: Date.now(),
        duration: 50,
        status: "success",
        connectionId: "conn-1",
      });

      const state = useQueryHistoryStore.getState();
      expect(state.entries).toHaveLength(1);
      expect(state.entries[0]!.sql).toBe("SELECT 1");
      expect(state.entries[0]!.id).toMatch(/^history-\d+$/);
    });

    it("adds an entry to globalLog array", () => {
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: "SELECT 1",
        executedAt: Date.now(),
        duration: 50,
        status: "success",
        connectionId: "conn-1",
      });

      const state = useQueryHistoryStore.getState();
      expect(state.globalLog).toHaveLength(1);
      expect(state.globalLog[0]!.sql).toBe("SELECT 1");
    });

    it("prepends new entries (most recent first)", () => {
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: "SELECT 1",
        executedAt: 1000,
        duration: 50,
        status: "success",
        connectionId: "conn-1",
      });
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: "SELECT 2",
        executedAt: 2000,
        duration: 60,
        status: "success",
        connectionId: "conn-1",
      });

      const state = useQueryHistoryStore.getState();
      expect(state.entries).toHaveLength(2);
      expect(state.entries[0]!.sql).toBe("SELECT 2");
      expect(state.entries[1]!.sql).toBe("SELECT 1");
      expect(state.globalLog[0]!.sql).toBe("SELECT 2");
    });
  });

  // -- Global log cap --

  describe("globalLog cap at 500", () => {
    it("caps globalLog at 500 entries (FIFO)", () => {
      for (let i = 0; i < 510; i++) {
        useQueryHistoryStore.getState().addHistoryEntry({
          sql: `SELECT ${i}`,
          executedAt: Date.now(),
          duration: 10,
          status: "success",
          connectionId: "conn-1",
        });
      }

      const state = useQueryHistoryStore.getState();
      expect(state.globalLog).toHaveLength(500);
      // Most recent entry should be first
      expect(state.globalLog[0]!.sql).toBe("SELECT 509");
      // Oldest kept entry
      expect(state.globalLog[499]!.sql).toBe("SELECT 10");
      // entries is uncapped
      expect(state.entries).toHaveLength(510);
    });
  });

  // -- Sprint 180 cancelled status (AC-180-03) --
  //
  // Reason: AC-180-03 widens `QueryHistoryEntry.status` to
  // `"success" | "error" | "cancelled"` so an aborted query records
  // distinctly. These cases pin the new variant at the store boundary —
  // both write (addHistoryEntry) and read (filteredGlobalLog) paths
  // honour the wider union. Type-level rejection of arbitrary string
  // literals is enforced by `pnpm tsc --noEmit`.
  // Date: 2026-04-30
  describe("cancelled status (sprint-180)", () => {
    // [AC-180-03a] Inserting a cancelled entry preserves the status
    // field exactly. The default normalisation path (paradigm/queryMode)
    // must not coerce or drop the new variant.
    // Date: 2026-04-30
    it("[AC-180-03a] insert cancelled entry preserves status field", () => {
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: "SELECT pg_sleep(5)",
        executedAt: 1000,
        duration: 1234,
        status: "cancelled",
        connectionId: "conn-1",
      });

      const state = useQueryHistoryStore.getState();
      expect(state.globalLog).toHaveLength(1);
      expect(state.globalLog[0]!.status).toBe("cancelled");
      expect(state.entries[0]!.status).toBe("cancelled");
    });

    // [AC-180-03b] Cancelled entries flow through `filteredGlobalLog`
    // selectors unchanged — the search/connection filters are content-
    // based, not status-based, so the new variant is visible by default.
    // Date: 2026-04-30
    it("[AC-180-03b] cancelled entries flow through filteredGlobalLog", () => {
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: "SELECT pg_sleep(5)",
        executedAt: 1000,
        duration: 800,
        status: "cancelled",
        connectionId: "conn-1",
      });
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: "SELECT 1",
        executedAt: 2000,
        duration: 5,
        status: "success",
        connectionId: "conn-1",
      });

      const filtered = useQueryHistoryStore.getState().filteredGlobalLog();
      expect(filtered).toHaveLength(2);
      const cancelled = filtered.find((e) => e.status === "cancelled");
      expect(cancelled).toBeDefined();
      expect(cancelled?.sql).toBe("SELECT pg_sleep(5)");
    });

    // Mix of success / error / cancelled — proves the three-way union
    // round-trips through both write and read without silent coercion.
    // Date: 2026-04-30
    it("preserves all three status variants in the same log", () => {
      const base = {
        executedAt: Date.now(),
        duration: 10,
        connectionId: "conn-1",
      };
      useQueryHistoryStore.getState().addHistoryEntry({
        ...base,
        sql: "S",
        status: "success",
      });
      useQueryHistoryStore.getState().addHistoryEntry({
        ...base,
        sql: "E",
        status: "error",
      });
      useQueryHistoryStore.getState().addHistoryEntry({
        ...base,
        sql: "C",
        status: "cancelled",
      });

      const log = useQueryHistoryStore.getState().globalLog;
      // FIFO prepend: most recent first.
      expect(log.map((e) => e.status)).toEqual([
        "cancelled",
        "error",
        "success",
      ]);
    });
  });

  // -- clearHistory --

  describe("clearHistory", () => {
    it("clears only entries, not globalLog", () => {
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: "SELECT 1",
        executedAt: Date.now(),
        duration: 50,
        status: "success",
        connectionId: "conn-1",
      });

      useQueryHistoryStore.getState().clearHistory();

      const state = useQueryHistoryStore.getState();
      expect(state.entries).toHaveLength(0);
      expect(state.globalLog).toHaveLength(1);
    });
  });

  // -- clearGlobalLog --

  describe("clearGlobalLog", () => {
    it("clears only globalLog, not entries", () => {
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: "SELECT 1",
        executedAt: Date.now(),
        duration: 50,
        status: "success",
        connectionId: "conn-1",
      });

      useQueryHistoryStore.getState().clearGlobalLog();

      const state = useQueryHistoryStore.getState();
      expect(state.globalLog).toHaveLength(0);
      expect(state.entries).toHaveLength(1);
    });
  });

  // -- Search filter --

  describe("setSearchFilter", () => {
    it("sets search filter state", () => {
      useQueryHistoryStore.getState().setSearchFilter("users");
      expect(useQueryHistoryStore.getState().searchFilter).toBe("users");
    });

    it("clears search filter with empty string", () => {
      useQueryHistoryStore.getState().setSearchFilter("users");
      useQueryHistoryStore.getState().setSearchFilter("");
      expect(useQueryHistoryStore.getState().searchFilter).toBe("");
    });
  });

  // -- Connection filter --

  describe("setConnectionFilter", () => {
    it("sets connection filter", () => {
      useQueryHistoryStore.getState().setConnectionFilter("conn-1");
      expect(useQueryHistoryStore.getState().connectionFilter).toBe("conn-1");
    });

    it("clears connection filter with null", () => {
      useQueryHistoryStore.getState().setConnectionFilter("conn-1");
      useQueryHistoryStore.getState().setConnectionFilter(null);
      expect(useQueryHistoryStore.getState().connectionFilter).toBeNull();
    });
  });

  // -- filteredGlobalLog --

  describe("filteredGlobalLog", () => {
    beforeEach(() => {
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: "SELECT * FROM users",
        executedAt: Date.now(),
        duration: 50,
        status: "success",
        connectionId: "conn-1",
      });
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: "SELECT * FROM orders",
        executedAt: Date.now(),
        duration: 100,
        status: "success",
        connectionId: "conn-2",
      });
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: "DROP TABLE users",
        executedAt: Date.now(),
        duration: 30,
        status: "error",
        connectionId: "conn-1",
      });
    });

    it("returns all entries when no filters are set", () => {
      const result = useQueryHistoryStore.getState().filteredGlobalLog();
      expect(result).toHaveLength(3);
    });

    it("filters by search text", () => {
      useQueryHistoryStore.getState().setSearchFilter("users");
      const result = useQueryHistoryStore.getState().filteredGlobalLog();
      expect(result).toHaveLength(2);
      result.forEach((entry) => {
        expect(entry.sql.toLowerCase()).toContain("users");
      });
    });

    it("filters by connection ID", () => {
      useQueryHistoryStore.getState().setConnectionFilter("conn-1");
      const result = useQueryHistoryStore.getState().filteredGlobalLog();
      expect(result).toHaveLength(2);
      result.forEach((entry) => {
        expect(entry.connectionId).toBe("conn-1");
      });
    });

    it("filters by both search and connection", () => {
      useQueryHistoryStore.getState().setSearchFilter("orders");
      useQueryHistoryStore.getState().setConnectionFilter("conn-2");
      const result = useQueryHistoryStore.getState().filteredGlobalLog();
      expect(result).toHaveLength(1);
      expect(result[0]!.sql).toBe("SELECT * FROM orders");
    });

    it("returns empty when no matches", () => {
      useQueryHistoryStore.getState().setSearchFilter("nonexistent");
      const result = useQueryHistoryStore.getState().filteredGlobalLog();
      expect(result).toHaveLength(0);
    });

    it("search is case-insensitive", () => {
      useQueryHistoryStore.getState().setSearchFilter("USERS");
      const result = useQueryHistoryStore.getState().filteredGlobalLog();
      expect(result).toHaveLength(2);
    });
  });

  // -- copyEntry --

  describe("copyEntry", () => {
    it("copies entry SQL to clipboard", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", {
        clipboard: { writeText },
      });

      useQueryHistoryStore.getState().addHistoryEntry({
        sql: "SELECT * FROM users",
        executedAt: Date.now(),
        duration: 50,
        status: "success",
        connectionId: "conn-1",
      });

      const entryId = useQueryHistoryStore.getState().globalLog[0]!.id;
      await useQueryHistoryStore.getState().copyEntry(entryId);

      expect(writeText).toHaveBeenCalledWith("SELECT * FROM users");

      vi.unstubAllGlobals();
    });

    it("does nothing for non-existent entry", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", {
        clipboard: { writeText },
      });

      await useQueryHistoryStore.getState().copyEntry("nonexistent");

      expect(writeText).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });

  // -- State independence --

  describe("state independence", () => {
    it("tests do not leak state between runs", () => {
      const state = useQueryHistoryStore.getState();
      expect(state.entries).toHaveLength(0);
      expect(state.globalLog).toHaveLength(0);
    });
  });

  // -- Sprint 84: paradigm / queryMode metadata --------------------------
  // AC-01..AC-05 map to these tests. The store is the single write boundary
  // for every executed query, so paradigm/queryMode must flow through both
  // `entries` and `globalLog` and selectors must normalise legacy shapes.

  describe("Sprint 84 paradigm metadata", () => {
    // AC-01 — RDB entry records paradigm:"rdb" + queryMode:"sql", no db/coll.
    it("records an rdb/sql entry with paradigm + queryMode (AC-01)", () => {
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: "SELECT 1",
        executedAt: Date.now(),
        duration: 50,
        status: "success",
        connectionId: "conn-rdb",
        paradigm: "rdb",
        queryMode: "sql",
      });

      const state = useQueryHistoryStore.getState();
      expect(state.entries[0]).toMatchObject({
        sql: "SELECT 1",
        paradigm: "rdb",
        queryMode: "sql",
        connectionId: "conn-rdb",
      });
      expect(state.entries[0]!.database).toBeUndefined();
      expect(state.entries[0]!.collection).toBeUndefined();
      // AC-04 — globalLog mirrors entries for every write.
      expect(state.globalLog[0]).toMatchObject({
        paradigm: "rdb",
        queryMode: "sql",
      });
    });

    // AC-02 — Document + find carries database/collection context.
    it("records a document/find entry with database + collection (AC-02)", () => {
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: '{"active":true}',
        executedAt: Date.now(),
        duration: 10,
        status: "success",
        connectionId: "conn-mongo",
        paradigm: "document",
        queryMode: "find",
        database: "table_view_test",
        collection: "users",
      });

      const state = useQueryHistoryStore.getState();
      expect(state.entries[0]).toMatchObject({
        paradigm: "document",
        queryMode: "find",
        database: "table_view_test",
        collection: "users",
      });
      expect(state.globalLog[0]).toMatchObject({
        paradigm: "document",
        queryMode: "find",
        database: "table_view_test",
        collection: "users",
      });
    });

    // AC-03 — Aggregate mode preserves queryMode="aggregate" alongside db/coll.
    it("records a document/aggregate entry with queryMode aggregate (AC-03)", () => {
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: '[{"$match":{"active":true}}]',
        executedAt: Date.now(),
        duration: 15,
        status: "success",
        connectionId: "conn-mongo",
        paradigm: "document",
        queryMode: "aggregate",
        database: "table_view_test",
        collection: "orders",
      });

      const state = useQueryHistoryStore.getState();
      expect(state.entries[0]).toMatchObject({
        paradigm: "document",
        queryMode: "aggregate",
        database: "table_view_test",
        collection: "orders",
      });
      expect(state.globalLog[0]!.queryMode).toBe("aggregate");
    });

    // Payload-defaulting regression — `addHistoryEntry` must accept entries
    // that omit paradigm + queryMode and still produce a valid entry.
    it("defaults paradigm/queryMode to rdb/sql when the payload omits them", () => {
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: "SELECT 1",
        executedAt: Date.now(),
        duration: 50,
        status: "success",
        connectionId: "conn-rdb",
      });

      const state = useQueryHistoryStore.getState();
      expect(state.entries[0]!.paradigm).toBe("rdb");
      expect(state.entries[0]!.queryMode).toBe("sql");
      expect(state.globalLog[0]!.paradigm).toBe("rdb");
      expect(state.globalLog[0]!.queryMode).toBe("sql");
    });

    // AC-05 — Legacy entries seeded via setState (simulating a future
    // persisted migration or a pre-Sprint-84 store snapshot) normalise to
    // rdb/sql when read through `filteredGlobalLog` without throwing.
    it("normalises legacy entries lacking paradigm via filteredGlobalLog (AC-05)", () => {
      // Cast through `unknown` because the public shape requires paradigm/
      // queryMode. The runtime-only escape hatch reproduces what a legacy
      // persisted entry would look like if read back verbatim.
      useQueryHistoryStore.setState({
        globalLog: [
          {
            id: "legacy-1",
            sql: "SELECT 1",
            executedAt: 1000,
            duration: 10,
            status: "success",
            connectionId: "conn-rdb",
          },
        ] as unknown as ReturnType<
          typeof useQueryHistoryStore.getState
        >["globalLog"],
      });

      // filteredGlobalLog() must not throw and must return an entry whose
      // paradigm/queryMode were defaulted to rdb/sql.
      expect(() =>
        useQueryHistoryStore.getState().filteredGlobalLog(),
      ).not.toThrow();

      const normalised = useQueryHistoryStore.getState().filteredGlobalLog();
      expect(normalised).toHaveLength(1);
      expect(normalised[0]!.paradigm).toBe("rdb");
      expect(normalised[0]!.queryMode).toBe("sql");
    });
  });

  // ---------------------------------------------------------------------------
  // AC-196-01 — `source` field plumbing on the entry type. Sprint 196 (FB-5b)
  // adds an explicit fire-point source so the global log can show which UI
  // surface produced an entry. `addHistoryEntry` accepts `source?` and the
  // store fills `"raw"` for omitted callsites; legacy `setState` paths
  // (no `source` at all) get normalised on read so badges + filters never
  // hit `undefined`. 2026-05-02.
  // ---------------------------------------------------------------------------

  describe("AC-196-01 — source field", () => {
    it("[AC-196-01-1] persists explicit source on the entry", () => {
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: "DROP TABLE foo",
        executedAt: Date.now(),
        duration: 5,
        status: "success",
        connectionId: "conn-1",
        source: "ddl-structure",
      });

      const state = useQueryHistoryStore.getState();
      expect(state.entries[0]!.source).toBe("ddl-structure");
      expect(state.globalLog[0]!.source).toBe("ddl-structure");
    });

    it("[AC-196-01-2] defaults missing source to 'raw'", () => {
      useQueryHistoryStore.getState().addHistoryEntry({
        sql: "SELECT 1",
        executedAt: Date.now(),
        duration: 5,
        status: "success",
        connectionId: "conn-1",
      });

      const state = useQueryHistoryStore.getState();
      expect(state.entries[0]!.source).toBe("raw");
      expect(state.globalLog[0]!.source).toBe("raw");
    });

    it("[AC-196-01-3] normalises legacy entries (no source field) to 'raw'", () => {
      // Mirrors the Sprint 84 legacy-paradigm normalisation pattern: a
      // pre-Sprint-196 entry restored via `setState` has no `source` field,
      // and the read path must fill it so the UI badge renders without
      // hitting `undefined`.
      useQueryHistoryStore.setState({
        globalLog: [
          {
            id: "legacy-1",
            sql: "SELECT 1",
            executedAt: 1000,
            duration: 10,
            status: "success",
            connectionId: "conn-rdb",
            paradigm: "rdb",
            queryMode: "sql",
          },
        ] as unknown as ReturnType<
          typeof useQueryHistoryStore.getState
        >["globalLog"],
      });

      const normalised = useQueryHistoryStore.getState().filteredGlobalLog();
      expect(normalised).toHaveLength(1);
      expect(normalised[0]!.source).toBe("raw");
    });
  });
});
