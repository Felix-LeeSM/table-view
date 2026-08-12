import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import {
  createPostgresConnection,
  expandIfCollapsed,
  openConnection,
  step,
  switchToWorkspaceWindow,
  waitForLauncher,
} from "./_helpers";

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
// Issue #2151 put the cardinality inside the edge's accessible name, because
// the visible badge is `aria-hidden` and "1:N" on its own says nothing. Every
// referenced end below is a PRIMARY KEY and no FK column carries a unique
// index (`e2e/fixtures/postgresql/query/seed.sql`), so all five read 1:N.
const EDGE_LABELS = [
  "public.erd_orders.customer_id references public.erd_customers.id (1:N)",
  "public.erd_order_items.order_id references public.erd_orders.id (1:N)",
  "public.erd_shipments.order_id references public.erd_orders.id (1:N)",
  "public.erd_payments.order_id references public.erd_orders.id (1:N)",
  "public.erd_refunds.payment_id references public.erd_payments.id (1:N)",
] as const;

// React Flow keys each node element by the SchemaGraph table id.
const CUSTOMERS_NODE_ID = "table:public.erd_customers";
const ORDERS_NODE_ID = "table:public.erd_orders";
const ORDER_ITEMS_NODE_ID = "table:public.erd_order_items";

describe("Dense ERD smoke", () => {
  it("renders the React Flow + elkjs ERD canvas on desktop and narrow viewports", async () => {
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
      "verify dense ERD desktop interactions and screenshot",
      async () => {
        await verifyDenseErdCanvas("desktop", "payments");
        await saveNonEmptyScreenshot("desktop");
      },
    );

    await step(
      "verify dense ERD narrow interactions and screenshot",
      async () => {
        await browser.setWindowSize(390, 900);
        await verifyDenseErdCanvas("narrow", "refunds");
        await saveNonEmptyScreenshot("narrow");
      },
    );
  });
});

async function verifyDenseErdCanvas(
  viewportName: "desktop" | "narrow",
  searchTerm: string,
) {
  const figure = await $('[aria-label="Database relationship diagram"]');
  await figure.waitForDisplayed({ timeout: 30000 });

  await waitForDenseGraphLabels(viewportName);
  await expectLayeredByForeignKeyDirection(viewportName);

  await selectTable("public.erd_orders table");
  await expectSelected("public.erd_orders table");
  await waitForMetadataStable(viewportName);

  await expectNodeIsDraggable(viewportName, "public.erd_orders table");

  await setErdSearch(searchTerm);
  await clickSearchResult(`public.erd_${searchTerm}`);
  await expectSelected(`public.erd_${searchTerm} table`);

  await expectViewportControls(viewportName);

  await setErdSearch("");
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

/**
 * elkjs `layered` with `elk.direction: UP` has to put a referenced table above
 * the table that references it. The seeded chain is
 * erd_order_items -> erd_orders -> erd_customers, so canvas y must decrease
 * along it. The old fixed 3-column grid could not satisfy this.
 */
async function expectLayeredByForeignKeyDirection(viewportName: string) {
  await browser.waitUntil(
    async () => (await readNodeY(CUSTOMERS_NODE_ID)) !== null,
    {
      timeout: 30000,
      timeoutMsg: `${viewportName} ERD nodes never received an elkjs position`,
    },
  );

  const customersY = await readNodeY(CUSTOMERS_NODE_ID);
  const ordersY = await readNodeY(ORDERS_NODE_ID);
  const orderItemsY = await readNodeY(ORDER_ITEMS_NODE_ID);
  if (customersY === null || ordersY === null || orderItemsY === null) {
    throw new Error(`${viewportName} ERD is missing a laid-out FK chain node`);
  }

  expect(customersY).toBeLessThan(ordersY);
  expect(ordersY).toBeLessThan(orderItemsY);
}

/**
 * Node drag is the capability the hand-rolled renderer never had. React Flow
 * writes the position back onto the node element's inline transform, so a drag
 * has to move it.
 *
 * The pointer sequence is synthesized in-page, the pattern every other spec
 * here uses (`e2e/smoke/grid-edit.ts`, `e2e/smoke/postgres-structure-ddl.spec.ts`).
 * WebdriverIO's Actions-API `dragAndDrop` was tried first and moved the node 0px
 * under tauri-driver — twice, in the first run and the retry (PR #2100).
 */
async function expectNodeIsDraggable(viewportName: string, ariaLabel: string) {
  const before = await readNodeTransform(ORDERS_NODE_ID);
  const card = await $(`[aria-label="${ariaLabel}"]`);
  await card.waitForDisplayed({ timeout: 10000 });
  await dispatchNodeDrag(ORDERS_NODE_ID, 140, 90);

  await browser.waitUntil(
    async () => {
      const after = await readNodeTransform(ORDERS_NODE_ID);
      return after !== null && after !== before;
    },
    {
      timeout: 10000,
      timeoutMsg: `${viewportName} ERD node did not move when dragged`,
    },
  );
}

/**
 * React Flow drags with d3-drag, which binds `mousedown` on the node element and
 * then `mousemove` / `mouseup` on `event.view` — so the mousedown must carry
 * `view: window` and the moves must be dispatched at the window, not the node.
 * `nodeDragThreshold` is 1, so the first move both starts and applies the drag;
 * a second move is sent so the assertion does not sit on the threshold.
 */
async function dispatchNodeDrag(
  nodeId: string,
  deltaX: number,
  deltaY: number,
) {
  await browser.execute(
    (id, dx, dy) => {
      const node = document.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${id}"]`,
      );
      if (!node) throw new Error(`${id} node did not appear`);

      const rect = node.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;

      const dispatch = (
        target: EventTarget,
        mouseType: string,
        pointerType: string,
        x: number,
        y: number,
        buttons: number,
      ) => {
        const eventInit = {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons,
          clientX: x,
          clientY: y,
        };
        const Pointer = window.PointerEvent;
        if (Pointer) {
          target.dispatchEvent(
            new Pointer(pointerType, {
              ...eventInit,
              isPrimary: true,
              pointerId: 1,
              pointerType: "mouse",
            }),
          );
        }
        target.dispatchEvent(new MouseEvent(mouseType, eventInit));
      };

      dispatch(node, "mousedown", "pointerdown", startX, startY, 1);
      dispatch(
        window,
        "mousemove",
        "pointermove",
        startX + dx / 2,
        startY + dy / 2,
        1,
      );
      dispatch(window, "mousemove", "pointermove", startX + dx, startY + dy, 1);
      dispatch(window, "mouseup", "pointerup", startX + dx, startY + dy, 0);
    },
    nodeId,
    deltaX,
    deltaY,
  );
}

/**
 * Zoom/fit are React Flow viewport operations now, so the exact zoom factor is
 * graph-dependent. What holds regardless: each control moves the readout in its
 * own direction, and fitting one table zooms in further than fitting the whole
 * graph. Every assertion here fails if its button stops doing anything — a
 * bounds check would not, because the readout is already clamped to
 * `ERD_MIN_ZOOM`/`ERD_MAX_ZOOM`.
 */
async function expectViewportControls(viewportName: string) {
  const zoomBefore = await waitForZoomPercent(viewportName);
  await clickButton("Zoom in ERD");
  await waitForZoom(
    viewportName,
    (zoom) => zoom > zoomBefore,
    "zoom-in did not raise the zoom percent",
  );
  await clickButton("Zoom in ERD");
  const zoomedIn = await waitForZoomSettled(viewportName);
  if (zoomedIn <= zoomBefore) {
    throw new Error(
      `${viewportName} ERD second zoom-in did not raise the zoom`,
    );
  }

  await clickButton("Zoom out ERD");
  await waitForZoom(
    viewportName,
    (zoom) => zoom < zoomedIn,
    "zoom-out did not lower the zoom percent",
  );

  await clickButton("Fit ERD");
  await waitForZoom(
    viewportName,
    (zoom) => zoom < zoomedIn,
    "fit-all did not pull the zoom back below the zoomed-in level",
  );
  const fitAllZoom = await waitForZoomSettled(viewportName);

  await clickButton("Fit selected table");
  await waitForZoom(
    viewportName,
    (zoom) => zoom > fitAllZoom,
    "fit-selected did not zoom in past the whole-graph fit",
  );
}

async function selectTable(ariaLabel: string) {
  const table = await $(`[aria-label="${ariaLabel}"]`);
  await table.waitForDisplayed({ timeout: 10000 });
  await table.click();
}

async function expectSelected(ariaLabel: string) {
  await browser.waitUntil(
    async () =>
      (await $(`[aria-label="${ariaLabel}"]`).getAttribute("aria-pressed")) ===
      "true",
    {
      timeout: 10000,
      timeoutMsg: `${ariaLabel} was not selected in the ERD`,
    },
  );
}

async function waitForMetadataStable(viewportName: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute(() => {
        const body = document.body.textContent?.toLowerCase() ?? "";
        return (
          body.includes("read-only schemagraph view") &&
          body.includes("incoming") &&
          body.includes("outgoing") &&
          !body.includes("dependency metadata incomplete") &&
          !body.includes("metadata readiness unknown")
        );
      }),
    {
      timeout: 30000,
      timeoutMsg: `${viewportName} ERD metadata did not stabilize`,
    },
  );
}

async function setErdSearch(value: string) {
  await browser.execute((nextValue) => {
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Search ERD tables"]',
    );
    if (!input) throw new Error("Search ERD tables input did not appear");
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("HTMLInputElement value setter missing");
    setter.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);

  await browser.waitUntil(
    async () =>
      await browser.execute(
        (expected) =>
          document.querySelector<HTMLInputElement>(
            '[aria-label="Search ERD tables"]',
          )?.value === expected,
        value,
      ),
    {
      timeout: 5000,
      timeoutMsg: "ERD search input did not receive expected value",
    },
  );
}

async function clickSearchResult(label: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute((expectedLabel) => {
        return Array.from(
          document.querySelectorAll<HTMLElement>('[role="option"]'),
        ).some((element) => element.textContent?.trim() === expectedLabel);
      }, label),
    {
      timeout: 10000,
      timeoutMsg: `${label} did not appear in ERD search results`,
    },
  );

  await browser.execute((expectedLabel) => {
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((element) => element.textContent?.trim() === expectedLabel);
    if (!option) throw new Error(`${expectedLabel} option did not appear`);
    option.click();
  }, label);
}

async function clickButton(ariaLabel: string) {
  const button = await $(`[aria-label="${ariaLabel}"]`);
  await button.waitForDisplayed({ timeout: 5000 });
  await button.click();
}

async function waitForZoomPercent(viewportName: string): Promise<number> {
  await browser.waitUntil(async () => (await readZoomPercent()) !== null, {
    timeout: 5000,
    timeoutMsg: `${viewportName} ERD zoom percent did not appear`,
  });

  const zoom = await readZoomPercent();
  if (zoom === null)
    throw new Error(`${viewportName} ERD zoom percent missing`);
  return zoom;
}

/**
 * Zoom transitions run for `ERD_TRANSITION_MS`, so a value read the instant a
 * predicate first holds can be a mid-animation frame. Wait until two reads in a
 * row agree before using the number as a baseline.
 */
async function waitForZoomSettled(viewportName: string): Promise<number> {
  let previous = await waitForZoomPercent(viewportName);
  await browser.waitUntil(
    async () => {
      const current = await readZoomPercent();
      if (current === null) return false;
      const settled = current === previous;
      previous = current;
      return settled;
    },
    {
      timeout: 10000,
      interval: 250,
      timeoutMsg: `${viewportName} ERD zoom percent never settled`,
    },
  );
  return previous;
}

async function waitForZoom(
  viewportName: string,
  predicate: (zoom: number) => boolean,
  reason: string,
) {
  await browser.waitUntil(
    async () => {
      const zoom = await readZoomPercent();
      return zoom !== null && predicate(zoom);
    },
    {
      timeout: 10000,
      timeoutMsg: `${viewportName} ERD ${reason}`,
    },
  );
}

async function readZoomPercent(): Promise<number | null> {
  await switchToWorkspaceWindow();
  return await browser.execute(() => {
    const label = document.querySelector<HTMLElement>(
      '[aria-label="ERD zoom percent"]',
    );
    const match = label?.textContent?.trim().match(/^(\d{1,3})%$/);
    return match ? Number(match[1]) : null;
  });
}

async function readNodeTransform(nodeId: string): Promise<string | null> {
  await switchToWorkspaceWindow();
  return await browser.execute((id) => {
    const node = document.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${id}"]`,
    );
    return node ? node.style.transform : null;
  }, nodeId);
}

async function readNodeY(nodeId: string): Promise<number | null> {
  const transform = await readNodeTransform(nodeId);
  const match = transform?.match(
    /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/,
  );
  return match ? Number(match[2]) : null;
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
