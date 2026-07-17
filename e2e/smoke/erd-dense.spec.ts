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
  it("renders dense SchemaGraph ERD evidence on desktop and narrow viewports", async () => {
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
        await verifyDenseErdSurface("desktop", "payments");
        await saveNonEmptyScreenshot("desktop");
      },
    );

    await step(
      "verify dense ERD narrow interactions and screenshot",
      async () => {
        await browser.setWindowSize(390, 900);
        await verifyDenseErdSurface("narrow", "refunds");
        await saveNonEmptyScreenshot("narrow");
      },
    );
  });
});

async function verifyDenseErdSurface(
  viewportName: "desktop" | "narrow",
  searchTerm: string,
) {
  const figure = await $('[aria-label="Database relationship diagram"]');
  await figure.waitForDisplayed({ timeout: 30000 });

  await waitForDenseGraphLabels(viewportName);
  await selectTable("public.erd_orders table");
  await expectSelected("public.erd_orders table");
  await waitForMetadataStable(viewportName);

  await setErdSearch(searchTerm);
  await clickSearchResult(`public.erd_${searchTerm}`);
  await expectSelected(`public.erd_${searchTerm} table`);

  const zoomBefore = await waitForZoomPercent(viewportName);
  await clickButton("Zoom in ERD");
  await browser.waitUntil(
    async () => {
      const zoom = await readZoomPercent();
      return zoom !== null && zoom > zoomBefore;
    },
    {
      timeout: 5000,
      timeoutMsg: `${viewportName} ERD zoom-in did not change the zoom percent`,
    },
  );

  await clickButton("Zoom out ERD");
  await clickButton("Fit ERD");
  await browser.waitUntil(
    async () => {
      const zoom = await readZoomPercent();
      return zoom === 85;
    },
    {
      timeout: 5000,
      timeoutMsg: `${viewportName} ERD fit did not set the expected zoom percent`,
    },
  );

  await clickButton("Fit selected table");
  await browser.waitUntil(
    async () => {
      const zoom = await readZoomPercent();
      return zoom === 100;
    },
    {
      timeout: 5000,
      timeoutMsg: `${viewportName} ERD fit-selected did not restore 100% zoom`,
    },
  );

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

async function readZoomPercent(): Promise<number | null> {
  await switchToWorkspaceWindow();
  return await browser.execute(() => {
    const label = document.querySelector<HTMLElement>(
      '[aria-label="ERD zoom percent"]',
    );
    const match = label?.textContent?.trim().match(/^(\d{2,3})%$/);
    return match ? Number(match[1]) : null;
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
