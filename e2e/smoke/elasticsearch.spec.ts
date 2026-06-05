import { browser, expect } from "@wdio/globals";
import {
  createElasticsearchConnection,
  openConnection,
  openNewQueryTab,
  runQuery,
  step,
  waitForLauncher,
  waitForWorkspaceTextAll,
} from "./_helpers";

const CONNECTION_NAME = "E2E Elasticsearch";
const INDEX =
  process.env.E2E_ELASTICSEARCH_INDEX ?? "table-view-elastic-2026.05.24";

type PublicConnection = {
  id: string;
  name: string;
};

type SearchDestructiveOperationPlan = {
  operation: "deleteByQuery";
  target: string;
  previewOnly: boolean;
  requiresConfirmation: boolean;
  warnings: string[];
  estimatedDocumentCount?: number;
};

describe("Elasticsearch smoke", () => {
  it("connects, browses catalog, renders Search hits, and plans delete-by-query safely", async () => {
    await step(
      "create Elasticsearch connection and open workspace",
      async () => {
        await waitForLauncher();
        await createElasticsearchConnection(CONNECTION_NAME);
        await openConnection(CONNECTION_NAME);
        await waitForWorkspaceTextAll(
          ["Search catalog", INDEX, "search-native"],
          30000,
          "Elasticsearch catalog did not render the seeded index",
        );
      },
    );

    await step("open the seeded index detail shell", async () => {
      await clickTreeItem(INDEX);
      await waitForWorkspaceTextAll(
        [INDEX, "Overview", "Mapping", "Samples"],
        15000,
        "Elasticsearch index detail shell did not render",
      );
    });

    await step("run bounded Search DSL and render hits/aggs", async () => {
      await openNewQueryTab();
      await setCodeMirrorText(
        JSON.stringify(
          {
            index: INDEX,
            body: {
              query: { match: { message: "fixture" } },
              aggs: {
                by_status: { terms: { field: "status.keyword", size: 10 } },
              },
              sort: [{ "@timestamp": "asc" }],
              _source: ["message", "status"],
            },
            size: 10,
            trackTotalHits: true,
          },
          null,
          2,
        ),
      );
      await runQuery();
      await waitForWorkspaceTextAll(
        ["2 hits", "fixture log", "fixture error", "by_status"],
        30000,
        "Elasticsearch SearchResultView did not render hits and aggregations",
      );
    });

    await step(
      "plan delete-by-query through the active Tauri connection",
      async () => {
        const connection = await findConnectionByName(CONNECTION_NAME);
        const plan = await invokeTauri<SearchDestructiveOperationPlan>(
          "plan_search_delete_by_query",
          {
            connectionId: connection.id,
            request: {
              indexPattern: INDEX,
              body: { query: { term: { "status.keyword": "error" } } },
              previewOnly: true,
              safety: {
                acknowledgedRisk: false,
                allowWildcard: false,
                expectedTarget: INDEX,
              },
            },
          },
        );

        expect(plan.operation).toBe("deleteByQuery");
        expect(plan.target).toBe(INDEX);
        expect(plan.previewOnly).toBe(true);
        expect(plan.requiresConfirmation).toBe(true);
        expect(plan.estimatedDocumentCount).toBe(1);
        expect(plan.warnings.join(" ")).toContain("confirmed");
      },
    );
  });
});

async function findConnectionByName(name: string): Promise<PublicConnection> {
  const connections = await invokeTauri<PublicConnection[]>("list_connections");
  const connection = connections.find((item) => item.name === name);
  if (!connection) {
    throw new Error(`${name} connection was not persisted`);
  }
  return connection;
}

async function clickTreeItem(label: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute((text) => {
        return Array.from(
          document.querySelectorAll<HTMLElement>('[role="treeitem"]'),
        ).some(
          (item) =>
            item.offsetParent !== null &&
            (item.textContent ?? "").includes(text),
        );
      }, label),
    {
      timeout: 15000,
      timeoutMsg: `${label} tree item did not appear`,
    },
  );
  await browser.execute((text) => {
    const item = Array.from(
      document.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    ).find(
      (candidate) =>
        candidate.offsetParent !== null &&
        (candidate.textContent ?? "").includes(text),
    );
    if (!item) throw new Error(`${text} tree item did not appear`);
    item.click();
  }, label);
}

async function setCodeMirrorText(text: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute((nextText) => {
        type CodeMirrorView = {
          state: { doc: { length: number; toString(): string } };
          focus(): void;
          dispatch(update: {
            changes: { from: number; to: number; insert: string };
          }): void;
        };
        type CodeMirrorContent = HTMLElement & {
          cmTile?: { root?: { view?: CodeMirrorView } };
        };

        const content = Array.from(
          document.querySelectorAll<CodeMirrorContent>(".cm-content"),
        ).find((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        });
        const view = content?.cmTile?.root?.view;
        if (!view) return false;
        const current = view.state.doc.toString();
        view.focus();
        if (current !== nextText) {
          view.dispatch({
            changes: { from: 0, to: current.length, insert: nextText },
          });
        }
        return view.state.doc.toString() === nextText;
      }, text),
    {
      timeout: 5000,
      timeoutMsg: "Search query editor did not accept direct input",
    },
  );
}

async function invokeTauri<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = (await browser.executeAsync(
    (cmd, payload, done) => {
      const invoke = (
        window as unknown as {
          __TAURI_INTERNALS__?: {
            invoke?: (
              command: string,
              args?: Record<string, unknown>,
            ) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__?.invoke;
      if (!invoke) {
        done({
          ok: false,
          error: "Tauri invoke bridge is not available in this window.",
        });
        return;
      }
      invoke(cmd, payload)
        .then((data) => done({ ok: true, data }))
        .catch((error) =>
          done({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    },
    command,
    args,
  )) as { ok: true; data: T } | { ok: false; error: string };

  if (result.ok) return result.data;
  throw new Error(result.error);
}
