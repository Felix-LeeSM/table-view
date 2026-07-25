import { $, browser, expect } from "@wdio/globals";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createPostgresConnection,
  expandIfCollapsed,
  openConnection,
  step,
  switchToWorkspaceWindow,
  waitForLauncher,
} from "./_helpers";

// Regression-pinned evidence (P5) for ADR 0054 / #1655: the ERD is a React
// Flow + elkjs `layered` canvas. This dense fixture proves the read-only
// foundation renders table nodes with their columns and FK edges, that zoom
// changes the viewport scale, and that fit-to-view re-frames the viewport with
// every node inside the canvas and every FK edge still arrow-headed, on desktop
// and narrow viewports. Selection / search / dependency-panel assertions were
// removed with the hand-rolled SVG renderer; those surfaces return in follow-up
// ERD issues (#1657+).
const CONNECTION_NAME = "E2E Postgres ERD Dense";
const TABLE_LABELS = [
  "public.erd_customers table",
  "public.erd_addresses table",
  "public.erd_orders table",
  "public.erd_order_items table",
  "public.erd_shipments table",
  "public.erd_payments table",
  "public.erd_refunds table",
] as const;
const EDGE_LABELS = [
  "public.erd_orders.customer_id references public.erd_customers.id",
  "public.erd_order_items.order_id references public.erd_orders.id",
  "public.erd_shipments.order_id references public.erd_orders.id",
  "public.erd_payments.order_id references public.erd_orders.id",
  "public.erd_refunds.payment_id references public.erd_payments.id",
] as const;

describe("Dense ERD smoke", () => {
  it("renders dense SchemaGraph ERD canvas evidence on desktop and narrow viewports", async () => {
    await step("create Postgres connection and open workspace", async () => {
      await browser.setWindowSize(1440, 1000);
      await waitForLauncher();
      await createPostgresConnection(CONNECTION_NAME);
      await openConnection(CONNECTION_NAME);
    });

    await step("open the database-level ERD tab", async () => {
      await expandIfCollapsed('[aria-label="public schema"]', 30000);
      await expandIfCollapsed('[aria-label="Tables in public"]');

      // Warm the schema/table cache by opening a seeded table first.
      const ordersTable = await $('[aria-label="erd_orders table"]');
      await ordersTable.waitForDisplayed({ timeout: 15000 });
      await ordersTable.click();

      // ERD moved from a table sub-tab to a database-level entry point: the
      // schema-tree header "Open ERD" action opens (and activates) a
      // top-level ERD tab for the current (connection, database).
      await switchToWorkspaceWindow();
      await clickButton("Open ERD diagram");
    });

    await step(
      "verify dense ERD canvas desktop interactions and screenshot",
      async () => {
        await verifyDenseErdCanvas("desktop");
        await saveNonEmptyScreenshot("desktop");
      },
    );

    await step(
      "verify dense ERD canvas narrow interactions and screenshot",
      async () => {
        await browser.setWindowSize(390, 900);
        await verifyDenseErdCanvas("narrow");
        await saveNonEmptyScreenshot("narrow");
      },
    );
  });
});

async function verifyDenseErdCanvas(viewportName: "desktop" | "narrow") {
  const figure = await $('[aria-label="Database relationship diagram"]');
  await figure.waitForDisplayed({ timeout: 30000 });

  await waitForDenseGraphLabels(viewportName);

  // Built-in React Flow zoom changes the viewport scale.
  const scaleBefore = await readViewportScale();
  await clickButton("Zoom In");
  await browser.waitUntil(
    async () => {
      const scale = await readViewportScale();
      return scale !== null && scaleBefore !== null && scale > scaleBefore;
    },
    {
      timeout: 5000,
      timeoutMsg: `${viewportName} ERD zoom-in did not increase the viewport scale`,
    },
  );

  // Fit-to-view re-frames the whole graph: the viewport transform leaves the
  // zoomed-in state and every table node ends up inside the canvas bounds.
  const transformAfterZoom = await readViewportTransform();
  await clickButton("Fit ERD");
  await browser.waitUntil(
    async () => {
      const transform = await readViewportTransform();
      return transform !== null && transform !== transformAfterZoom;
    },
    {
      timeout: 5000,
      timeoutMsg: `${viewportName} ERD fit-to-view did not re-frame the viewport`,
    },
  );
  await figure.waitForDisplayed({ timeout: 5000 });
  expect(await countNodesOutsideCanvas()).toBe(0);

  // FK edges keep an arrow head at the referenced end, so the fitted graph
  // still reads as directed (regression guard for the dropped `markerEnd`,
  // PR #1783 review).
  expect(await countEdgePathsWithoutArrowHead()).toBe(0);
}

async function waitForDenseGraphLabels(viewportName: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute(
        ({ tables, edges }) => {
          const labels = Array.from(document.querySelectorAll("[aria-label]"))
            .map((element) => element.getAttribute("aria-label") ?? "")
            .filter(Boolean);
          return (
            tables.every((label) => labels.includes(label)) &&
            edges.every((label) => labels.includes(label))
          );
        },
        { tables: [...TABLE_LABELS], edges: [...EDGE_LABELS] },
      ),
    {
      timeout: 30000,
      timeoutMsg: `${viewportName} ERD did not expose dense table nodes and FK edges`,
    },
  );
}

async function clickButton(ariaLabel: string) {
  const button = await $(`[aria-label="${ariaLabel}"]`);
  await button.waitForDisplayed({ timeout: 5000 });
  await button.click();
}

async function readViewportTransform(): Promise<string | null> {
  await switchToWorkspaceWindow();
  return await browser.execute(() => {
    const viewport = document.querySelector<HTMLElement>(
      ".react-flow__viewport",
    );
    return viewport?.style.transform ?? null;
  });
}

async function readViewportScale(): Promise<number | null> {
  const match = (await readViewportTransform())?.match(/scale\(([\d.]+)\)/);
  return match ? Number(match[1]) : null;
}

// Returns -1 when the canvas pane is missing so the caller's `toBe(0)` fails
// loudly instead of passing on an empty node set.
async function countNodesOutsideCanvas(): Promise<number> {
  await switchToWorkspaceWindow();
  return await browser.execute(() => {
    const pane = document
      .querySelector(".react-flow__viewport")
      ?.closest(".react-flow");
    const nodes = Array.from(document.querySelectorAll(".react-flow__node"));
    if (!pane || nodes.length === 0) return -1;
    const bounds = pane.getBoundingClientRect();
    // 1px tolerance for sub-pixel rounding of the fitted transform.
    return nodes.filter((node) => {
      const rect = node.getBoundingClientRect();
      return (
        rect.left < bounds.left - 1 ||
        rect.top < bounds.top - 1 ||
        rect.right > bounds.right + 1 ||
        rect.bottom > bounds.bottom + 1
      );
    }).length;
  });
}

async function countEdgePathsWithoutArrowHead(): Promise<number> {
  await switchToWorkspaceWindow();
  return await browser.execute(() => {
    const paths = Array.from(
      document.querySelectorAll(".react-flow__edge-path"),
    );
    if (paths.length === 0) return -1;
    return paths.filter((path) => !path.getAttribute("marker-end")).length;
  });
}

async function saveNonEmptyScreenshot(viewportName: string) {
  await switchToWorkspaceWindow();
  const reportDir = resolve(
    process.cwd(),
    process.env.E2E_REPORT_DIR ?? "e2e/wdio-report",
  );
  await mkdir(reportDir, { recursive: true });
  const screenshotPath = resolve(reportDir, `erd-dense-${viewportName}.png`);
  const png = await browser.takeScreenshot();
  await writeFile(screenshotPath, Buffer.from(png, "base64"));

  const { size } = await stat(screenshotPath);
  expect(size).toBeGreaterThan(1024);
}
