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
});
