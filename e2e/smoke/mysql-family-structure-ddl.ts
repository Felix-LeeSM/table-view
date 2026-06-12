import { $, $$, browser } from "@wdio/globals";
import {
  expandIfCollapsed,
  openNewQueryTab,
  runQuery,
  step,
  switchToWorkspaceWindow,
  typeQuery,
  waitForGridTextAll,
  waitForWorkspaceTextAll,
} from "./_helpers";

type MysqlFamilyLabel = "MySQL" | "MariaDB";

export async function runMysqlFamilyStructureDdlSmoke({
  dbLabel,
  database,
}: {
  dbLabel: MysqlFamilyLabel;
  database: string;
}) {
  const ddlSuffix = randomIdentifierSuffix();
  const ddlTableName = `structure_ddl_${dbLabel.toLowerCase()}_${ddlSuffix}`;
  const ddlIndexName = `idx_${ddlTableName}_label`;
  const ddlFkName = `fk_${ddlTableName}_user`;

  await step(
    `create ${dbLabel} bounded Structure DDL table through preview`,
    async () => {
      await openCreateTableDialogFromDatabase(database);
      await fillMysqlFamilyStructureDdlForm({
        tableName: ddlTableName,
        indexName: ddlIndexName,
        fkName: ddlFkName,
      });
      await waitForDdlPreview(
        [
          "CREATE TABLE",
          `\`${database}\`.\`${ddlTableName}\``,
          "`user_id` BIGINT",
          "CREATE INDEX",
          `\`${ddlIndexName}\``,
          "USING BTREE ON",
          "ALTER TABLE",
          `\`${ddlFkName}\``,
          "FOREIGN KEY (`user_id`)",
          "REFERENCES `users` (`id`)",
        ],
        dbLabel,
      );
      await clickEnabledButtonText("Execute");
      await waitUntilTextGone("Create Table", 20000);
    },
  );

  await step(
    `verify ${dbLabel} Structure tabs show created index and FK`,
    async () => {
      await verifyMysqlFamilyStructureTabs({
        dbLabel,
        tableName: ddlTableName,
        indexName: ddlIndexName,
        fkName: ddlFkName,
      });
    },
  );

  await step(
    `verify ${dbLabel} information_schema shows physical index and FK`,
    async () => {
      await verifyMysqlFamilyPhysicalDdl({
        dbLabel,
        tableName: ddlTableName,
        indexName: ddlIndexName,
        fkName: ddlFkName,
      });
    },
  );
}

function randomIdentifierSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function openCreateTableDialogFromDatabase(database: string) {
  await expandIfCollapsed(`[aria-label="Tables in ${database}"]`, 30000);
  await clickAria(`Create table in ${database}`);
  await waitForVisibleText("Create Table", 10000);
}

async function fillMysqlFamilyStructureDdlForm({
  tableName,
  indexName,
  fkName,
}: {
  tableName: string;
  indexName: string;
  fkName: string;
}) {
  await setInputByAria("Table name", tableName);
  await setNthInputByAria("Column name", 0, "user_id");
  await setNthInputByAria("Column data type", 0, "BIGINT");

  await clickAria("Add column");
  await setNthInputByAria("Column name", 1, "label");
  await setNthInputByAria("Column data type", 1, "VARCHAR(64)");

  await activateVisibleTab("Indexes");
  await clickAria("Add index");
  await setInputByAria("Index name", indexName);
  await clickAria("Index column: label");

  await activateVisibleTab("Constraints");
  await clickEnabledButtonText("Foreign Key");
  await setInputByAria("Foreign key name", fkName);
  await clickAria("Foreign key local column: user_id");
  await selectOrSetByAria("Foreign key reference table", "users");
  await selectOrSetReferenceColumn("id");
}

async function verifyMysqlFamilyStructureTabs({
  dbLabel,
  tableName,
  indexName,
  fkName,
}: {
  dbLabel: string;
  tableName: string;
  indexName: string;
  fkName: string;
}) {
  const table = await $(`[aria-label="${tableName} table"]`);
  await table.waitForDisplayed({
    timeout: 20000,
    timeoutMsg: `${dbLabel} created table ${tableName} did not appear after Structure DDL execution`,
  });
  await table.click();

  await activateVisibleTab("Structure");
  await activateVisibleTab("Indexes");
  await waitForWorkspaceTextAll(
    [indexName, "label"],
    20000,
    `${dbLabel} Structure Indexes tab did not show ${indexName}`,
  );

  await activateVisibleTab("Constraints");
  await waitForWorkspaceTextAll(
    [fkName, "FOREIGN KEY", "users(id)"],
    20000,
    `${dbLabel} Structure Constraints tab did not show ${fkName}`,
  );
}

async function verifyMysqlFamilyPhysicalDdl({
  dbLabel,
  tableName,
  indexName,
  fkName,
}: {
  dbLabel: string;
  tableName: string;
  indexName: string;
  fkName: string;
}) {
  await openNewQueryTab();
  await typeQuery(
    [
      "SELECT INDEX_NAME AS created_index, COLUMN_NAME AS indexed_column",
      "FROM information_schema.STATISTICS",
      `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${sqlStringLiteral(
        tableName,
      )}`,
      `AND INDEX_NAME = ${sqlStringLiteral(indexName)}`,
    ].join(" "),
  );
  await runQuery();
  await waitForGridTextAll(
    ["created_index", "indexed_column", indexName, "label"],
    15000,
    `${dbLabel} physical index ${indexName} did not appear in information_schema.STATISTICS`,
  );

  await typeQuery(
    [
      "SELECT CONSTRAINT_NAME AS created_fk, CAST(REFERENCED_TABLE_NAME AS CHAR) AS referenced_table, REFERENCED_COLUMN_NAME AS referenced_column",
      "FROM information_schema.KEY_COLUMN_USAGE",
      `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${sqlStringLiteral(
        tableName,
      )}`,
      `AND CONSTRAINT_NAME = ${sqlStringLiteral(fkName)}`,
      "AND REFERENCED_TABLE_NAME = 'users' AND REFERENCED_COLUMN_NAME = 'id'",
    ].join(" "),
  );
  await runQuery();
  await waitForGridTextAll(
    [
      "created_fk",
      "referenced_table",
      "referenced_column",
      fkName,
      "users",
      "id",
    ],
    15000,
    `${dbLabel} physical FK ${fkName} did not appear in information_schema.KEY_COLUMN_USAGE`,
  );
}

async function activateVisibleTab(label: string) {
  await switchToWorkspaceWindow();
  await browser.waitUntil(
    async () =>
      await browser.execute((expectedLabel) => {
        return Array.from(
          document.querySelectorAll<HTMLElement>('[role="tab"]'),
        ).some(
          (candidate) =>
            candidate.offsetParent !== null &&
            candidate.textContent?.trim() === expectedLabel,
        );
      }, label),
    {
      timeout: 10000,
      timeoutMsg: `${label} tab did not appear in the workspace`,
    },
  );

  await browser.execute((expectedLabel) => {
    const tab = Array.from(
      document.querySelectorAll<HTMLElement>('[role="tab"]'),
    ).find(
      (candidate) =>
        candidate.offsetParent !== null &&
        candidate.textContent?.trim() === expectedLabel,
    );
    if (!tab) throw new Error(`${expectedLabel} tab did not appear`);

    tab.focus();

    const pointerInit = {
      bubbles: true,
      cancelable: true,
      pointerType: "mouse",
      button: 0,
    };
    if (typeof PointerEvent === "function") {
      tab.dispatchEvent(
        new PointerEvent("pointerdown", { ...pointerInit, buttons: 1 }),
      );
      tab.dispatchEvent(new PointerEvent("pointerup", pointerInit));
    }

    tab.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
      }),
    );
    tab.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
    tab.click();
  }, label);

  await browser.waitUntil(
    async () =>
      await browser.execute((expectedLabel) => {
        const tab = Array.from(
          document.querySelectorAll<HTMLElement>('[role="tab"]'),
        ).find(
          (candidate) =>
            candidate.offsetParent !== null &&
            candidate.textContent?.trim() === expectedLabel,
        );
        return tab?.getAttribute("aria-selected") === "true";
      }, label),
    {
      timeout: 10000,
      timeoutMsg: `${label} tab did not become active in the workspace`,
    },
  );
}

async function setInputByAria(label: string, value: string) {
  await setNthInputByAria(label, 0, value);
}

async function setNthInputByAria(label: string, index: number, value: string) {
  await browser.waitUntil(
    async () => (await $$(ariaSelector(label))).length > index,
    {
      timeout: 10000,
      timeoutMsg: `${label} input #${index} did not appear`,
    },
  );
  await browser.execute(
    (ariaLabel, nth, nextValue) => {
      const input = Array.from(
        document.querySelectorAll<HTMLInputElement>("input[aria-label]"),
      ).filter(
        (candidate) => candidate.getAttribute("aria-label") === ariaLabel,
      )[nth];
      if (!input) throw new Error(`${ariaLabel} input #${nth} did not appear`);

      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("HTMLInputElement value setter missing");

      input.focus();
      setter.call(input, nextValue);
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
    },
    label,
    index,
    value,
  );
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (ariaLabel, nth, expected) =>
          Array.from(
            document.querySelectorAll<HTMLInputElement>("input[aria-label]"),
          ).filter(
            (candidate) => candidate.getAttribute("aria-label") === ariaLabel,
          )[nth]?.value === expected,
        label,
        index,
        value,
      ),
    {
      timeout: 5000,
      timeoutMsg: `${label} input #${index} did not update`,
    },
  );
}

async function selectOrSetByAria(label: string, value: string) {
  const control = await $(ariaSelector(label));
  await control.waitForDisplayed({ timeout: 10000 });
  if ((await control.getTagName()).toLowerCase() === "input") {
    await setInputByAria(label, value);
    return;
  }

  await control.click();
  await clickOptionText(value);
}

async function selectOrSetReferenceColumn(column: string) {
  const checkboxLabel = `Foreign key reference column: ${column}`;
  await browser.waitUntil(
    async () =>
      (await isDisplayed(ariaSelector(checkboxLabel))) ||
      (await isDisplayed(ariaSelector("Foreign key reference columns text"))),
    {
      timeout: 15000,
      timeoutMsg: `Foreign key reference column ${column} picker did not appear`,
    },
  );

  if (await isDisplayed(ariaSelector(checkboxLabel))) {
    await clickAria(checkboxLabel);
    return;
  }
  await setInputByAria("Foreign key reference columns text", column);
}

async function clickAria(label: string) {
  const control = await $(ariaSelector(label));
  await control.waitForDisplayed({ timeout: 10000 });
  await control.click();
}

async function waitForDdlPreview(snippets: string[], dbLabel: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute((needles) => {
        const text =
          document.querySelector<HTMLElement>("#create-table-ddl-preview")
            ?.textContent ?? "";
        return needles.every((needle) =>
          text.toLowerCase().includes(needle.toLowerCase()),
        );
      }, snippets),
    {
      timeout: 15000,
      timeoutMsg: `${dbLabel} DDL preview did not include ${snippets.join(
        ", ",
      )}`,
    },
  );
}

async function clickEnabledButtonText(text: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute((needle) => {
        const isVisible = (element: HTMLElement) => {
          const style = window.getComputedStyle(element);
          return (
            element.getClientRects().length > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        };
        return Array.from(
          document.querySelectorAll<HTMLButtonElement>("button"),
        ).some(
          (candidate) =>
            isVisible(candidate) &&
            candidate.textContent?.trim() === needle &&
            !candidate.disabled,
        );
      }, text),
    {
      timeout: 15000,
      timeoutMsg: `${text} enabled button did not appear`,
    },
  );
  await browser.execute((needle) => {
    const isVisible = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      return (
        element.getClientRects().length > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find(
      (candidate) =>
        isVisible(candidate) &&
        candidate.textContent?.trim() === needle &&
        !candidate.disabled,
    );
    if (!button) throw new Error(`${needle} enabled button did not appear`);
    button.click();
  }, text);
}

async function clickOptionText(text: string) {
  const option = await $(
    `//*[@role="option" and normalize-space(.)=${xpathLiteral(text)}]`,
  );
  await option.waitForDisplayed({ timeout: 10000 });
  await option.click();
}

async function waitForVisibleText(text: string, timeout: number) {
  await waitForWorkspaceTextAll(
    [text],
    timeout,
    `${text} did not become visible`,
  );
}

async function waitUntilTextGone(text: string, timeout: number) {
  await browser.waitUntil(
    async () =>
      await browser.execute((needle) => {
        const isVisible = (element: HTMLElement) => {
          const style = window.getComputedStyle(element);
          return (
            element.getClientRects().length > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        };
        return !Array.from(
          document.querySelectorAll<HTMLElement>('[role="dialog"]'),
        ).some(
          (candidate) =>
            isVisible(candidate) &&
            (candidate.textContent ?? "").includes(needle),
        );
      }, text),
    { timeout, timeoutMsg: `${text} dialog did not close` },
  );
}

async function isDisplayed(selector: string): Promise<boolean> {
  return await $(selector)
    .isDisplayed()
    .catch(() => false);
}

function ariaSelector(label: string): string {
  return `[aria-label="${label.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
}

function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat('${value.replaceAll("'", `', "'", '`)}')`;
}
