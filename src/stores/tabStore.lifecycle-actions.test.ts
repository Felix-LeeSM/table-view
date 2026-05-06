import { describe, it, expect, beforeEach } from "vitest";
import {
  useTabStore,
  type TableTab,
  type QueryTab,
  SYNCED_KEYS,
} from "./tabStore";
import {
  makeTableTab,
  getTableTab,
  getQueryTab,
  buildRunningQueryTabState,
} from "./__tests__/tabStoreTestHelpers";

describe("tabStore — lifecycle actions (Sprint 97 / 130 / 153 / 195)", () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: [],
      activeTabId: null,
      dirtyTabIds: new Set<string>(),
    });
  });

  // -- Sprint 97: dirty tab tracking ----------------------------------------

  describe("setTabDirty / dirtyTabIds", () => {
    beforeEach(() => {
      useTabStore.setState({
        tabs: [],
        activeTabId: null,
        closedTabHistory: [],
        dirtyTabIds: new Set<string>(),
      });
    });

    it("starts empty", () => {
      expect(useTabStore.getState().dirtyTabIds.size).toBe(0);
    });

    it("adds the id when setTabDirty(id, true)", () => {
      useTabStore.getState().setTabDirty("tab-1", true);

      const dirty = useTabStore.getState().dirtyTabIds;
      expect(dirty.has("tab-1")).toBe(true);
      expect(dirty.size).toBe(1);
    });

    it("removes the id when setTabDirty(id, false)", () => {
      useTabStore.getState().setTabDirty("tab-1", true);
      expect(useTabStore.getState().dirtyTabIds.has("tab-1")).toBe(true);

      useTabStore.getState().setTabDirty("tab-1", false);

      expect(useTabStore.getState().dirtyTabIds.has("tab-1")).toBe(false);
    });

    it("is a no-op when membership already matches the requested value", () => {
      // Idempotent dirty=true → keeps Set referential equality so subscriber
      // selectors don't re-render on every keystroke during editing.
      useTabStore.getState().setTabDirty("tab-1", true);
      const before = useTabStore.getState().dirtyTabIds;
      useTabStore.getState().setTabDirty("tab-1", true);
      const after = useTabStore.getState().dirtyTabIds;
      expect(after).toBe(before);

      // Idempotent dirty=false on a non-member tab also preserves identity.
      const cleanBefore = useTabStore.getState().dirtyTabIds;
      useTabStore.getState().setTabDirty("never-dirty", false);
      const cleanAfter = useTabStore.getState().dirtyTabIds;
      expect(cleanAfter).toBe(cleanBefore);
    });

    it("tracks multiple dirty tabs independently", () => {
      useTabStore.getState().setTabDirty("tab-1", true);
      useTabStore.getState().setTabDirty("tab-2", true);

      const dirty = useTabStore.getState().dirtyTabIds;
      expect(dirty.has("tab-1")).toBe(true);
      expect(dirty.has("tab-2")).toBe(true);

      useTabStore.getState().setTabDirty("tab-1", false);
      const after = useTabStore.getState().dirtyTabIds;
      expect(after.has("tab-1")).toBe(false);
      expect(after.has("tab-2")).toBe(true);
    });

    it("removeTab also drops the dirty marker", () => {
      useTabStore.getState().addTab(makeTableTab({ id: "t1", table: "users" }));
      const tabId = useTabStore.getState().tabs[0]!.id;
      useTabStore.getState().setTabDirty(tabId, true);
      expect(useTabStore.getState().dirtyTabIds.has(tabId)).toBe(true);

      useTabStore.getState().removeTab(tabId);

      expect(useTabStore.getState().dirtyTabIds.has(tabId)).toBe(false);
    });
  });

  // -- Sprint 130 — RDB tab database autofill ---------------------------

  describe("RDB database autofill (Sprint 130)", () => {
    beforeEach(async () => {
      // Reset connectionStore so the autofill helper has known input.
      const { useConnectionStore } = await import("./connectionStore");
      useConnectionStore.setState({
        connections: [],
        activeStatuses: {},
      });
    });

    it("autofills database from activeStatuses[id].activeDb when adding an RDB table tab", async () => {
      const { useConnectionStore } = await import("./connectionStore");
      useConnectionStore.setState({
        connections: [],
        activeStatuses: {
          conn1: { type: "connected", activeDb: "warehouse" },
        },
      });
      useTabStore.getState().addTab(makeTableTab({ id: "ignored" }));
      const tab = getTableTab(useTabStore.getState(), 0);
      expect(tab.database).toBe("warehouse");
    });

    it("falls back to connection.database when activeDb is not yet set", async () => {
      const { useConnectionStore } = await import("./connectionStore");
      useConnectionStore.setState({
        connections: [
          {
            id: "conn1",
            name: "TestDB",
            db_type: "postgresql",
            host: "localhost",
            port: 5432,
            user: "postgres",
            database: "postgres",
            group_id: null,
            color: null,
            has_password: false,
            paradigm: "rdb",
          },
        ],
        activeStatuses: { conn1: { type: "connected" } },
      });
      useTabStore.getState().addTab(makeTableTab({ id: "ignored" }));
      const tab = getTableTab(useTabStore.getState(), 0);
      expect(tab.database).toBe("postgres");
    });

    it("autofills database for a new RDB query tab from activeDb", async () => {
      const { useConnectionStore } = await import("./connectionStore");
      useConnectionStore.setState({
        connections: [],
        activeStatuses: {
          conn1: { type: "connected", activeDb: "reporting" },
        },
      });
      useTabStore.getState().addQueryTab("conn1");
      const qt = getQueryTab(useTabStore.getState(), 0);
      expect(qt.paradigm).toBe("rdb");
      expect(qt.database).toBe("reporting");
    });

    it("does not overwrite an explicitly-passed database on addQueryTab", async () => {
      const { useConnectionStore } = await import("./connectionStore");
      useConnectionStore.setState({
        connections: [],
        activeStatuses: {
          conn1: { type: "connected", activeDb: "warehouse" },
        },
      });
      useTabStore.getState().addQueryTab("conn1", { database: "explicit_db" });
      const qt = getQueryTab(useTabStore.getState(), 0);
      expect(qt.database).toBe("explicit_db");
    });

    it("does not migrate already-persisted RDB tabs (autofill is creation-only)", () => {
      // Simulate an RDB tab already in the store with no `database` —
      // the contract forbids touching legacy persisted tabs. Adding a
      // brand-new tab should populate `database`, but the existing tab
      // must stay untouched.
      const persistedTab: TableTab = {
        type: "table",
        id: "existing",
        title: "legacy",
        connectionId: "conn1",
        closable: true,
        schema: "public",
        table: "legacy_table",
        subView: "records",
      };
      useTabStore.setState({ tabs: [persistedTab], activeTabId: "existing" });
      const tab = useTabStore.getState().tabs[0] as TableTab;
      expect(tab.database).toBeUndefined();
    });

    it("does not autofill database for document paradigm query tabs (S131 handles use_db)", async () => {
      const { useConnectionStore } = await import("./connectionStore");
      useConnectionStore.setState({
        connections: [],
        activeStatuses: {
          conn1: { type: "connected", activeDb: "warehouse" },
        },
      });
      useTabStore.getState().addQueryTab("conn1", { paradigm: "document" });
      const qt = getQueryTab(useTabStore.getState(), 0);
      expect(qt.paradigm).toBe("document");
      // Document tabs only inherit a database when the caller passes one.
      expect(qt.database).toBeUndefined();
    });
  });

  // -- Sprint 153 (AC-153-06) — cross-window broadcast allowlist regression --
  //
  // `SYNCED_KEYS` pins which top-level state keys ride the `tab-sync`
  // channel. Critical exclusions:
  //  - `dirtyTabIds` is a `Set<string>` and is NOT JSON-serializable, so
  //    broadcasting it would corrupt the receiver's state.
  //  - `closedTabHistory` is per-window undo scope — a Cmd-Shift-T in one
  //    window must not resurrect a tab the OTHER window closed.
  // The bridge itself only attaches in the workspace window (guarded by
  // `getCurrentWindowLabel()`); this regression pins the allowlist shape.
  describe("SYNCED_KEYS allowlist (AC-153-06)", () => {
    it("exposes exactly the cross-window-synced tab keys", () => {
      expect([...SYNCED_KEYS]).toEqual(["tabs", "activeTabId"]);
    });

    it("does NOT include dirtyTabIds (Set, non-serializable)", () => {
      expect(SYNCED_KEYS).not.toContain("dirtyTabIds");
    });

    it("does NOT include closedTabHistory (window-local undo scope)", () => {
      expect(SYNCED_KEYS).not.toContain("closedTabHistory");
    });
  });

  // ── Sprint 195 — intent-revealing query lifecycle actions ───────────────
  //
  // These actions hide the guarded `running → completed | error` transition
  // pattern that QueryTab.tsx previously inlined 7 times via raw
  // `useTabStore.setState((state) => ...)`. The guards ensure stale
  // responses (late-arriving result for a queryId that was already
  // superseded) cannot overwrite a fresher query's state.
  describe("query lifecycle actions (sprint-195 §3.1 extraction)", () => {
    const sampleResult = {
      columns: [{ name: "n", data_type: "integer" }],
      rows: [[1]],
      total_count: 1,
      execution_time_ms: 5,
      query_type: "select" as const,
    };

    describe("[AC-195-01] completeQuery / failQuery guards", () => {
      it("[AC-195-01-1] completeQuery transitions running → completed when queryId matches", () => {
        useTabStore.setState(buildRunningQueryTabState("q1", "q1-1"));
        useTabStore
          .getState()
          .completeQuery("q1", "q1-1", sampleResult as never);
        const tab = getQueryTab(useTabStore.getState(), 0);
        expect(tab.queryState).toEqual({
          status: "completed",
          result: sampleResult,
        });
      });

      it("[AC-195-01-2] completeQuery is a no-op when queryId mismatches (stale response)", () => {
        useTabStore.setState(buildRunningQueryTabState("q1", "q1-1"));
        useTabStore
          .getState()
          .completeQuery("q1", "q1-stale", sampleResult as never);
        const tab = getQueryTab(useTabStore.getState(), 0);
        expect(tab.queryState).toEqual({ status: "running", queryId: "q1-1" });
      });

      it("[AC-195-01-3] completeQuery is a no-op when tab is not running", () => {
        const tab: QueryTab = {
          type: "query",
          id: "q1",
          title: "Query 1",
          connectionId: "conn1",
          closable: true,
          sql: "SELECT 1",
          queryState: { status: "idle" },
          paradigm: "rdb",
          queryMode: "sql",
        } as QueryTab;
        useTabStore.setState({ tabs: [tab], activeTabId: "q1" });

        useTabStore
          .getState()
          .completeQuery("q1", "anything", sampleResult as never);
        const out = getQueryTab(useTabStore.getState(), 0);
        expect(out.queryState).toEqual({ status: "idle" });
      });

      it("[AC-195-01-4] completeQuery is a no-op for missing tab", () => {
        useTabStore.setState({ tabs: [], activeTabId: null });
        useTabStore
          .getState()
          .completeQuery("missing", "any", sampleResult as never);
        expect(useTabStore.getState().tabs).toHaveLength(0);
      });

      it("[AC-195-01-5] failQuery transitions running → error when queryId matches", () => {
        useTabStore.setState(buildRunningQueryTabState("q1", "q1-1"));
        useTabStore.getState().failQuery("q1", "q1-1", "boom");
        const tab = getQueryTab(useTabStore.getState(), 0);
        expect(tab.queryState).toEqual({ status: "error", error: "boom" });
      });

      it("[AC-195-01-6] failQuery is a no-op when queryId mismatches (stale response)", () => {
        useTabStore.setState(buildRunningQueryTabState("q1", "q1-1"));
        useTabStore.getState().failQuery("q1", "q1-stale", "boom");
        const tab = getQueryTab(useTabStore.getState(), 0);
        expect(tab.queryState).toEqual({ status: "running", queryId: "q1-1" });
      });
    });

    describe("[AC-195-02] completeMultiStatementQuery allFailed branching", () => {
      const stmt = (status: "success" | "error", error?: string) => ({
        sql: status === "success" ? "SELECT 1" : "SELECT bad",
        status,
        result: status === "success" ? sampleResult : undefined,
        error,
        durationMs: 1,
      });

      it("[AC-195-02-1] allFailed → error with joined message", () => {
        useTabStore.setState(buildRunningQueryTabState("q1", "q1-1"));
        useTabStore.getState().completeMultiStatementQuery("q1", "q1-1", {
          statementResults: [
            stmt("error", "syntax 1") as never,
            stmt("error", "syntax 2") as never,
          ],
          lastResult: null,
          allFailed: true,
          joinedErrorMessage: "Statement 1: syntax 1\nStatement 2: syntax 2",
        });
        const tab = getQueryTab(useTabStore.getState(), 0);
        expect(tab.queryState.status).toBe("error");
      });

      it("[AC-195-02-2] partial failure → completed with statements + lastResult", () => {
        useTabStore.setState(buildRunningQueryTabState("q1", "q1-1"));
        useTabStore.getState().completeMultiStatementQuery("q1", "q1-1", {
          statementResults: [
            stmt("success") as never,
            stmt("error", "later one failed") as never,
          ],
          lastResult: sampleResult as never,
          allFailed: false,
          joinedErrorMessage: "ignored",
        });
        const tab = getQueryTab(useTabStore.getState(), 0);
        expect(tab.queryState.status).toBe("completed");
        if (tab.queryState.status === "completed") {
          expect(tab.queryState.result).toEqual(sampleResult);
          expect(tab.queryState.statements).toHaveLength(2);
        }
      });

      it("[AC-195-02-3] all-success → completed with statements + lastResult", () => {
        useTabStore.setState(buildRunningQueryTabState("q1", "q1-1"));
        useTabStore.getState().completeMultiStatementQuery("q1", "q1-1", {
          statementResults: [
            stmt("success") as never,
            stmt("success") as never,
          ],
          lastResult: sampleResult as never,
          allFailed: false,
          joinedErrorMessage: "",
        });
        const tab = getQueryTab(useTabStore.getState(), 0);
        expect(tab.queryState.status).toBe("completed");
      });
    });

    // Sprint 212 — `recordHistory` 시그니처 제거. 사전 AC-195-03 (3 case) +
    // AC-196-02 (2 case) 의 5건은 store-level wrapper 의 단위 검증 — store
    // 측 wrapper 가 사라지면 더 이상 store-level test 로 의미가 없다.
    // 동등 커버리지는 `useQueryExecution` 의 통합 path (8 call site, success/
    // error/cancelled, single/multi/document find/aggregate, default `source:
    // "raw"`) 가 `useQueryHistoryStore.entries` shape 으로 검증한다 — 신규
    // case 추가 없음, source-of-truth 가 통합 layer 로 이동.
  });
});
