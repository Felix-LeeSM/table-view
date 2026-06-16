import { browser, expect } from "@wdio/globals";
import {
  openConnection,
  openNewQueryTab,
  runQuery,
  searchSmokePassword,
  searchSmokeUser,
  step,
  waitForLauncher,
  waitForWorkspaceTextAll,
} from "./_helpers";

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

type SearchDbType = "elasticsearch" | "opensearch";

type SearchProbeConfig = {
  id: string;
  name: string;
  dbType: SearchDbType;
  host: string;
  port: number;
  user: string;
  database: string;
  readOnly: boolean;
  groupId: string | null;
  color: string | null;
  connectionTimeout: number;
  keepAliveInterval: number | null;
  environment: string;
  hasPassword: boolean;
  paradigm: "search";
  authSource: null;
  replicaSet: null;
  tlsEnabled: boolean;
};

type SearchRuntimeSmokeOptions = {
  productLabel: "Elasticsearch" | "OpenSearch";
  connectionName: string;
  index: string;
  createConnection(name: string): Promise<void>;
};

export function runSearchRuntimeSmoke(options: SearchRuntimeSmokeOptions) {
  const { productLabel, connectionName, index, createConnection } = options;
  const dbType: SearchDbType =
    productLabel === "Elasticsearch" ? "elasticsearch" : "opensearch";

  describe(`${productLabel} smoke`, () => {
    it("connects, browses catalog, renders Search hits, and plans delete-by-query safely", async () => {
      await step(
        `probe live ${productLabel} connect/auth/TLS contract`,
        async () => {
          await waitForLauncher();
          const baseConfig = makeSearchProbeConfig(dbType, productLabel);
          const probePassword = searchProbePassword(dbType);
          expect(baseConfig.user).not.toBe("");
          expect(probePassword).not.toBe("");

          const result = await invokeTauri<string>("test_connection", {
            req: {
              config: baseConfig,
              password: probePassword,
              existing_id: null,
            },
          });
          expect(result).toBe("Connection successful");

          await expectTauriCommandError(
            "test_connection",
            {
              req: {
                config: baseConfig,
                password: wrongSearchProbePassword(dbType),
                existing_id: null,
              },
            },
            [
              "Search authentication error",
              `${productLabel} authentication failed`,
              "401",
              "root probe",
            ],
          );

          const authenticatedRetry = await invokeTauri<string>(
            "test_connection",
            {
              req: {
                config: baseConfig,
                password: probePassword,
                existing_id: null,
              },
            },
          );
          expect(authenticatedRetry).toBe("Connection successful");

          await expectTauriCommandError(
            "test_connection",
            {
              req: {
                config: { ...baseConfig, tlsEnabled: true },
                password: probePassword,
                existing_id: null,
              },
            },
            [productLabel, "TLS error", "root probe"],
          );

          const oppositeDbType: SearchDbType =
            dbType === "elasticsearch" ? "opensearch" : "elasticsearch";
          await expectTauriCommandError(
            "test_connection",
            {
              req: {
                config: {
                  ...baseConfig,
                  id: `e2e-${oppositeDbType}-mismatch-probe`,
                  name: `E2E ${oppositeDbType} mismatch probe`,
                  dbType: oppositeDbType,
                },
                password: probePassword,
                existing_id: null,
              },
            },
            [
              `Expected ${oppositeDbType === "elasticsearch" ? "Elasticsearch" : "OpenSearch"} endpoint`,
              `detected ${productLabel}`,
            ],
          );
        },
      );

      await step(
        `create ${productLabel} connection and open workspace`,
        async () => {
          await createConnection(connectionName);
          await openConnection(connectionName);
          await waitForWorkspaceTextAll(
            ["Search catalog", index, "search-native"],
            30000,
            `${productLabel} catalog did not render the seeded index`,
          );
        },
      );

      await step("open the seeded index detail shell", async () => {
        await clickTreeItem(index);
        await waitForWorkspaceTextAll(
          [index, "Overview", "Mapping", "Samples"],
          15000,
          `${productLabel} index detail shell did not render`,
        );
      });

      await step("verify selected index metadata tabs", async () => {
        await clickDetailTab("Mapping");
        await waitForWorkspaceTextAll(
          ["@timestamp", "message", "status", "aggregatable"],
          15000,
          `${productLabel} mapping metadata did not render`,
        );

        await clickDetailTab("Settings");
        await waitForWorkspaceTextAll(
          ["Settings JSON", "number_of_shards"],
          15000,
          `${productLabel} settings metadata did not render`,
        );

        await clickDetailTab("Field stats");
        await waitForWorkspaceTextAll(
          ["@timestamp", "message", "keyword"],
          15000,
          `${productLabel} field stats metadata did not render`,
        );
      });

      await step("run bounded Search DSL and render hits/aggs", async () => {
        await openNewQueryTab();
        await setCodeMirrorText(
          JSON.stringify(
            {
              index,
              body: {
                query: { match: { message: "fixture" } },
                aggs: {
                  by_status: { terms: { field: "status.keyword", size: 10 } },
                },
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
          `${productLabel} SearchResultView did not render hits and aggregations`,
        );
      });

      await step(
        "surface bounded Search DSL errors in the result view",
        async () => {
          await setCodeMirrorText(
            JSON.stringify(
              {
                index,
                body: {
                  query: { match_all: {} },
                  profile: true,
                },
              },
              null,
              2,
            ),
          );
          await runQuery();
          await waitForWorkspaceTextAll(
            ["Search query failed", "profile"],
            30000,
            `${productLabel} unsupported Search DSL feature did not surface in the UI`,
          );
        },
      );

      await step(
        "plan delete-by-query through the active Tauri connection",
        async () => {
          const connection = await findConnectionByName(connectionName);
          const plan = await invokeTauri<SearchDestructiveOperationPlan>(
            "plan_search_delete_by_query",
            {
              connectionId: connection.id,
              request: {
                indexPattern: index,
                body: { query: { term: { "status.keyword": "error" } } },
                previewOnly: true,
                safety: {
                  acknowledgedRisk: false,
                  allowWildcard: false,
                  expectedTarget: index,
                },
              },
            },
          );

          expect(plan.operation).toBe("deleteByQuery");
          expect(plan.target).toBe(index);
          expect(plan.previewOnly).toBe(true);
          expect(plan.requiresConfirmation).toBe(false);
          expect(plan.estimatedDocumentCount).toBe(1);
          expect(plan.warnings.join(" ")).toContain("execution is unsupported");
        },
      );
    });
  });
}

function makeSearchProbeConfig(
  dbType: SearchDbType,
  productLabel: "Elasticsearch" | "OpenSearch",
): SearchProbeConfig {
  return {
    id: `e2e-${dbType}-live-probe`,
    name: `E2E ${productLabel} live probe`,
    dbType,
    host: searchProbeHost(dbType),
    port: searchProbePort(dbType),
    user: searchProbeUser(dbType),
    database: "",
    readOnly: false,
    groupId: null,
    color: null,
    connectionTimeout: 10,
    keepAliveInterval: null,
    environment: "testing",
    hasPassword: Boolean(searchProbePassword(dbType)),
    paradigm: "search",
    authSource: null,
    replicaSet: null,
    tlsEnabled: false,
  };
}

function searchProbeHost(dbType: SearchDbType): string {
  if (dbType === "elasticsearch") {
    return (
      process.env.E2E_ELASTICSEARCH_HOST ??
      process.env.ELASTICSEARCH_HOST ??
      "localhost"
    );
  }
  return (
    process.env.E2E_OPENSEARCH_HOST ??
    process.env.OPENSEARCH_HOST ??
    "localhost"
  );
}

function searchProbePort(dbType: SearchDbType): number {
  const raw =
    dbType === "elasticsearch"
      ? (process.env.E2E_ELASTICSEARCH_PORT ??
        process.env.ELASTICSEARCH_PORT ??
        "19200")
      : (process.env.E2E_OPENSEARCH_PORT ??
        process.env.OPENSEARCH_PORT ??
        "29200");
  return Number.parseInt(raw, 10);
}

function searchProbeUser(dbType: SearchDbType): string {
  return searchSmokeUser(dbType);
}

function searchProbePassword(dbType: SearchDbType): string {
  return searchSmokePassword(dbType);
}

function wrongSearchProbePassword(dbType: SearchDbType): string {
  return `${searchProbePassword(dbType)}-wrong`;
}

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

async function clickDetailTab(label: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute((text) => {
        return Array.from(
          document.querySelectorAll<HTMLElement>('[role="tab"], button'),
        ).some(
          (item) =>
            item.offsetParent !== null &&
            (item.textContent ?? "").trim().includes(text),
        );
      }, label),
    {
      timeout: 15000,
      timeoutMsg: `${label} detail tab did not appear`,
    },
  );
  await browser.execute((text) => {
    const item = Array.from(
      document.querySelectorAll<HTMLElement>('[role="tab"], button'),
    ).find(
      (candidate) =>
        candidate.offsetParent !== null &&
        (candidate.textContent ?? "").trim().includes(text),
    );
    if (!item) throw new Error(`${text} detail tab did not appear`);
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

async function expectTauriCommandError(
  command: string,
  args: Record<string, unknown>,
  expectedParts: string[],
): Promise<void> {
  let message = "";
  try {
    await invokeTauri<unknown>(command, args);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  expect(message).not.toBe("");
  for (const part of expectedParts) {
    expect(message).toContain(part);
  }
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
