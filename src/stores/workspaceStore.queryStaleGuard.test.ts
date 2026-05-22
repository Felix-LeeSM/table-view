import { beforeEach, describe, expect, it } from "vitest";
import type { QueryResult, QueryStatementResult } from "@/types/query";
import { useWorkspaceStore } from "./workspaceStore";
import {
  buildRunningQueryWorkspaceState,
  DEFAULT_TEST_CONN,
  DEFAULT_TEST_DB,
  getQueryTab,
} from "./__tests__/workspaceStoreTestHelpers";

const TAB_ID = "query-1";
const CURRENT_QUERY_ID = "query-current";
const STALE_QUERY_ID = "query-stale";

const RESULT: QueryResult = {
  columns: [],
  rows: [],
  totalCount: 0,
  executionTimeMs: 1,
  queryType: "select",
};

const STATEMENTS: QueryStatementResult[] = [
  {
    sql: "SELECT 1",
    status: "success",
    result: RESULT,
    durationMs: 1,
  },
];

function currentTab() {
  const ws =
    useWorkspaceStore.getState().workspaces[DEFAULT_TEST_CONN]?.[
      DEFAULT_TEST_DB
    ];
  if (!ws) throw new Error("Expected seeded workspace");
  return getQueryTab(ws, 0);
}

describe("workspaceStore — running query stale guard", () => {
  beforeEach(() => {
    useWorkspaceStore.setState(
      buildRunningQueryWorkspaceState(TAB_ID, CURRENT_QUERY_ID),
    );
  });

  it.each([
    {
      name: "completeQuery",
      run: () =>
        useWorkspaceStore
          .getState()
          .completeQuery(
            DEFAULT_TEST_CONN,
            DEFAULT_TEST_DB,
            TAB_ID,
            STALE_QUERY_ID,
            RESULT,
          ),
    },
    {
      name: "failQuery",
      run: () =>
        useWorkspaceStore
          .getState()
          .failQuery(
            DEFAULT_TEST_CONN,
            DEFAULT_TEST_DB,
            TAB_ID,
            STALE_QUERY_ID,
            "old failure",
          ),
    },
    {
      name: "completeMultiStatementQuery",
      run: () =>
        useWorkspaceStore
          .getState()
          .completeMultiStatementQuery(
            DEFAULT_TEST_CONN,
            DEFAULT_TEST_DB,
            TAB_ID,
            STALE_QUERY_ID,
            {
              statementResults: STATEMENTS,
              lastResult: RESULT,
              allFailed: false,
              joinedErrorMessage: "",
            },
          ),
    },
    {
      name: "completeQueryDryRun",
      run: () =>
        useWorkspaceStore
          .getState()
          .completeQueryDryRun(
            DEFAULT_TEST_CONN,
            DEFAULT_TEST_DB,
            TAB_ID,
            STALE_QUERY_ID,
            RESULT,
            STATEMENTS,
          ),
    },
  ])(
    "$name ignores stale responses and preserves the visible running query",
    ({ run }) => {
      run();

      expect(currentTab().queryState).toEqual({
        status: "running",
        queryId: CURRENT_QUERY_ID,
      });
    },
  );
});
