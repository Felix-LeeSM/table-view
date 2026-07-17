import { describe, expect, it } from "vitest";
import { rawEntryKey } from "@stores/rawQueryGridEditStore";
import { entryKey } from "@stores/dataGridEditStore";
import type { ExecuteRdbSingleStatementRequest } from "@components/query/QueryTab/rdbQueryExecution";
import type { InlineFkPopoverProps } from "@components/schema/CreateTableDialog/InlineFkPopover";
import type { QueryTab, TableTab } from "@stores/workspaceStore";
import type {
  ConnectionId,
  DatabaseName,
  SchemaName,
  TableName,
  TabId,
} from "./branded";

/**
 * Type-level regression for issue #1493. The real assertion runs under
 * `tsc --noEmit`: each `@ts-expect-error` below must be a LIVE suppression,
 * i.e. the swapped call is a genuine compile error. Before `rawEntryKey` /
 * `findLiveIdleTab` were branded these calls type-checked (both args were
 * plain `string`), so the directive was unused and `tsc` failed — that is
 * the RED this test locks in. The runtime `expect` keeps the file a valid
 * vitest suite and pins the key shape.
 */
describe("branded ConnectionId / TabId argument-order safety", () => {
  const connectionId = "conn-1" as ConnectionId;
  const tabId = "tab-1" as TabId;

  it("composes the raw entry key from (connectionId, tabId)", () => {
    expect(rawEntryKey(connectionId, tabId)).toBe("conn-1::tab-1");
  });

  it("rejects a swapped rawEntryKey call at compile time", () => {
    // @ts-expect-error swapped (tabId, connectionId) order must not compile
    expect(rawEntryKey(tabId, connectionId)).toBe("tab-1::conn-1");
  });

  it("rejects a swapped findLiveIdleTab call at compile time", () => {
    type FindLiveIdleTab = ExecuteRdbSingleStatementRequest["findLiveIdleTab"];
    const findLiveIdleTab = ((): unknown => null) as FindLiveIdleTab;
    // Canonical order is (connectionId, tabId).
    expect(findLiveIdleTab(connectionId, tabId)).toBeNull();
    // @ts-expect-error swapped (tabId, connectionId) order must not compile
    expect(findLiveIdleTab(tabId, connectionId)).toBeNull();
  });
});

/**
 * Type-level regression for issue #1494 (branded Phase 2). Same live-directive
 * discipline as above: before `entryKey`'s four positional args carried
 * distinct brands they were all plain `string`, so the swapped call below
 * type-checked and the `@ts-expect-error` was unused — `tsc --noEmit` fails.
 * That is the RED. After branding, the schema/table (and database) swaps are
 * genuine compile errors, the directives become live, and `tsc` passes.
 */
describe("branded DatabaseName / SchemaName / TableName entryKey order safety", () => {
  const connectionId = "conn-1" as ConnectionId;
  const database = "app" as DatabaseName;
  const schema = "public" as SchemaName;
  const table = "users" as TableName;

  it("composes the entry key from (connectionId, database, schema, table)", () => {
    expect(entryKey(connectionId, database, schema, table)).toBe(
      "conn-1::app::public::users",
    );
  });

  it("rejects a swapped (schema, database) entryKey call at compile time", () => {
    // @ts-expect-error swapped database/schema args must not compile
    expect(entryKey(connectionId, schema, database, table)).toBe(
      "conn-1::public::app::users",
    );
  });

  it("rejects a swapped (schema, table) entryKey call at compile time", () => {
    // @ts-expect-error swapped schema/table args must not compile
    expect(entryKey(connectionId, database, table, schema)).toBe(
      "conn-1::app::users::public",
    );
  });
});

/**
 * Type-level regression for issue #1495 (branded Phase 3). The inline FK
 * reference picker's `onTablePicked(schema, table)` collided with the schema
 * catalog's table-last argument order: a swapped call searched "orders.public"
 * instead of "public.orders" and silently found nothing. Same live-directive
 * discipline — before `SchemaName` / `TableName` were applied to the callback
 * both args were plain `string`, so the swapped call type-checked and the
 * `@ts-expect-error` was unused (`tsc --noEmit` fails, the RED). After
 * branding, the swap is a genuine compile error and the directive is live.
 */
describe("branded SchemaName / TableName FK picker order safety", () => {
  const schema = "public" as SchemaName;
  const table = "orders" as TableName;

  it("rejects a swapped InlineFkPopover onTablePicked call at compile time", () => {
    type OnTablePicked = InlineFkPopoverProps["onTablePicked"];
    const onTablePicked = ((): void => {}) as OnTablePicked;
    // Canonical order is (schema, table).
    onTablePicked(schema, table);
    // @ts-expect-error swapped (table, schema) order must not compile
    onTablePicked(table, schema);
    expect(true).toBe(true);
  });
});

/**
 * Type-level regression for issue #1494 follow-up (PR #1498/#1511 review).
 * `TableTab.connectionId` / `QueryTab.connectionId` are now `ConnectionId`, so
 * a plain `string` can no longer be written into a tab's connection id — the
 * value must be minted at the tab-creation boundary. Same live-directive
 * discipline as above: before branding these fields were plain `string`, so the
 * literals below type-checked and the `@ts-expect-error` directives were unused
 * (`tsc --noEmit` fails, the RED). After branding they are genuine compile
 * errors and the directives become live.
 */
describe("branded ConnectionId TableTab/QueryTab.connectionId safety", () => {
  it("rejects a plain-string connectionId on a TableTab", () => {
    const tab: TableTab = {
      type: "table",
      id: "t1" as TabId,
      title: "public.users",
      // @ts-expect-error plain string is not assignable to branded ConnectionId
      connectionId: "conn-1",
      closable: true,
      subView: "records",
    };
    expect(tab.connectionId).toBe("conn-1");
  });

  it("rejects a plain-string connectionId on a QueryTab", () => {
    const tab: QueryTab = {
      type: "query",
      id: "q1" as TabId,
      title: "Query",
      // @ts-expect-error plain string is not assignable to branded ConnectionId
      connectionId: "conn-1",
      closable: true,
      sql: "",
      queryState: { status: "idle" },
      paradigm: "rdb",
    };
    expect(tab.connectionId).toBe("conn-1");
  });
});
