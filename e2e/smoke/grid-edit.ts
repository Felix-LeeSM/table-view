import { $, browser } from "@wdio/globals";

import { switchToWorkspaceWindow } from "./_helpers";
import { normalizeGridEditorLabel } from "./grid-edit-label";

export async function editGridCellInRow(
  rowNeedle: string,
  ariaColIndex: number,
  nextValue: string,
  editorLabel: string,
) {
  await switchToWorkspaceWindow();

  let targetCell: WebdriverIO.Element | null = null;
  await browser.waitUntil(
    async () => {
      targetCell = await findGridCellInRow(rowNeedle, ariaColIndex);
      return targetCell !== null;
    },
    {
      timeout: 15000,
      timeoutMsg: `grid row containing ${rowNeedle} did not expose editable column ${ariaColIndex}`,
    },
  );

  if (!targetCell) {
    throw new Error(
      `grid row containing ${rowNeedle} did not contain column ${ariaColIndex}`,
    );
  }

  await targetCell.scrollIntoView();
  const resolvedEditorLabel = await openGridCellEditor(
    targetCell,
    rowNeedle,
    ariaColIndex,
    editorLabel,
  );
  await setGridEditorValue(resolvedEditorLabel, nextValue);

  const commit = await $('[aria-label="Commit changes"]');
  await commit.waitForDisplayed({ timeout: 10000 });
}

async function openGridCellEditor(
  targetCell: WebdriverIO.Element,
  rowNeedle: string,
  ariaColIndex: number,
  editorLabel: string,
): Promise<string> {
  await targetCell.doubleClick();
  await browser.pause(100);
  let editor = await findDisplayedEditor(editorLabel);
  if (editor) return editor;

  await targetCell.click();
  await targetCell.click();
  await browser.pause(100);
  editor = await findDisplayedEditor(editorLabel);
  if (editor) return editor;

  await dispatchGridCellDoubleClick(rowNeedle, ariaColIndex);
  await browser.pause(100);
  editor = await findDisplayedEditor(editorLabel, 5000);
  if (editor) return editor;

  await dispatchGridCellContextMenu(rowNeedle, ariaColIndex);
  const clickedEdit = await clickVisibleMenuItem("Edit Cell");
  if (clickedEdit) {
    editor = await findDisplayedEditor(editorLabel, 5000);
    if (editor) return editor;
  }

  throw new Error(`grid editor ${editorLabel} did not open`);
}

async function setGridEditorValue(editorLabel: string, nextValue: string) {
  await browser.execute(
    (label, value) => {
      const editor = Array.from(
        document.querySelectorAll<HTMLInputElement>("input[aria-label]"),
      ).find((candidate) => candidate.getAttribute("aria-label") === label);
      if (!editor) throw new Error(`${label} input did not appear`);

      editor.focus();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("HTMLInputElement value setter missing");

      setter.call(editor, value);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          code: "Enter",
          key: "Enter",
        }),
      );
    },
    editorLabel,
    nextValue,
  );
}

async function findDisplayedEditor(
  editorLabel: string,
  timeout = 500,
): Promise<string | null> {
  const normalizedLabel = normalizeGridEditorLabel(editorLabel);
  let resolvedLabel: string | null = null;
  try {
    await browser.waitUntil(
      async () => {
        resolvedLabel = await browser.execute(
          (label, normalized) => {
            const element = Array.from(
              document.querySelectorAll<HTMLElement>("[aria-label]"),
            ).find((candidate) => {
              const actualLabel = candidate.getAttribute("aria-label");
              if (
                actualLabel !== label &&
                actualLabel?.toLowerCase() !== normalized
              ) {
                return false;
              }

              const style = window.getComputedStyle(candidate);
              return (
                candidate.getClientRects().length > 0 &&
                style.display !== "none" &&
                style.visibility !== "hidden"
              );
            });
            if (!element) return null;

            return element.getAttribute("aria-label");
          },
          editorLabel,
          normalizedLabel,
        );
        return resolvedLabel !== null;
      },
      {
        timeout,
        interval: 100,
        timeoutMsg: `${editorLabel} editor did not appear in the DOM`,
      },
    );
  } catch {
    return null;
  }

  return resolvedLabel;
}

async function dispatchGridCellDoubleClick(
  rowNeedle: string,
  ariaColIndex: number,
) {
  await browser.execute(
    (needle, colIndex) => {
      const rows = Array.from(document.querySelectorAll('[role="row"]'));
      const row = rows.find((candidate) =>
        ((candidate as HTMLElement).textContent ?? "").includes(needle),
      );
      const cell = row?.querySelector<HTMLElement>(
        `[role="gridcell"][aria-colindex="${colIndex}"]`,
      );
      if (!cell) return;

      const rect = cell.getBoundingClientRect();
      const eventInit: MouseEventInit = {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        view: window,
      };
      const dispatchPointer = (
        type: string,
        detail: number,
        buttons: number,
      ) => {
        const Pointer = window.PointerEvent;
        if (!Pointer) return;
        cell.dispatchEvent(
          new Pointer(type, {
            ...eventInit,
            button: 0,
            buttons,
            detail,
            isPrimary: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
      };

      dispatchPointer("pointerdown", 1, 1);
      cell.dispatchEvent(new MouseEvent("mousedown", eventInit));
      dispatchPointer("pointerup", 1, 0);
      cell.dispatchEvent(new MouseEvent("mouseup", eventInit));
      cell.dispatchEvent(new MouseEvent("click", { ...eventInit, detail: 1 }));
      dispatchPointer("pointerdown", 2, 1);
      cell.dispatchEvent(new MouseEvent("mousedown", eventInit));
      dispatchPointer("pointerup", 2, 0);
      cell.dispatchEvent(new MouseEvent("mouseup", eventInit));
      cell.dispatchEvent(new MouseEvent("click", { ...eventInit, detail: 2 }));
      cell.dispatchEvent(
        new MouseEvent("dblclick", { ...eventInit, detail: 2 }),
      );
    },
    rowNeedle,
    ariaColIndex,
  );
}

async function dispatchGridCellContextMenu(
  rowNeedle: string,
  ariaColIndex: number,
) {
  await browser.execute(
    (needle, colIndex) => {
      const rows = Array.from(document.querySelectorAll('[role="row"]'));
      const row = rows.find((candidate) =>
        ((candidate as HTMLElement).textContent ?? "").includes(needle),
      );
      const cell = row?.querySelector<HTMLElement>(
        `[role="gridcell"][aria-colindex="${colIndex}"]`,
      );
      if (!cell) return;

      const rect = cell.getBoundingClientRect();
      cell.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          buttons: 2,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          view: window,
        }),
      );
    },
    rowNeedle,
    ariaColIndex,
  );
}

async function clickVisibleMenuItem(label: string, timeout = 1500) {
  try {
    await browser.waitUntil(
      async () =>
        await browser.execute((text) => {
          return Array.from(
            document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
          ).some((item) => {
            const style = window.getComputedStyle(item);
            return (
              item.textContent?.trim() === text &&
              item.getClientRects().length > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              item.getAttribute("aria-disabled") !== "true"
            );
          });
        }, label),
      {
        timeout,
        interval: 100,
        timeoutMsg: `${label} menu item did not appear`,
      },
    );
  } catch {
    return false;
  }

  await browser.execute((text) => {
    const item = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((candidate) => candidate.textContent?.trim() === text);
    if (!item) throw new Error(`${text} menu item did not appear`);
    item.click();
  }, label);
  return true;
}

async function findGridCellInRow(
  rowNeedle: string,
  ariaColIndex: number,
): Promise<WebdriverIO.Element | null> {
  const rowIndex = await browser.execute(
    (needle, colIndex) => {
      const rows = Array.from(document.querySelectorAll('[role="row"]'));
      for (const row of rows) {
        const element = row as HTMLElement;
        if (!isVisibleElement(element)) continue;
        if (!(element.textContent ?? "").includes(needle)) continue;

        const cell = element.querySelector<HTMLElement>(
          `[role="gridcell"][aria-colindex="${colIndex}"]`,
        );
        if (cell && isVisibleElement(cell)) {
          return element.getAttribute("aria-rowindex");
        }
      }
      return null;

      function isVisibleElement(element: HTMLElement) {
        const style = window.getComputedStyle(element);
        return (
          element.getClientRects().length > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      }
    },
    rowNeedle,
    ariaColIndex,
  );

  if (typeof rowIndex !== "string" || rowIndex.length === 0) {
    return null;
  }

  const cell = await $(
    `[role="row"][aria-rowindex="${rowIndex}"] [role="gridcell"][aria-colindex="${ariaColIndex}"]`,
  );
  if ((await cell.isExisting()) && (await isDisplayed(cell))) {
    return cell;
  }
  return null;
}

async function isDisplayed(element: WebdriverIO.Element): Promise<boolean> {
  try {
    return await element.isDisplayed();
  } catch {
    return false;
  }
}
