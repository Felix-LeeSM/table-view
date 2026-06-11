import { vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useSchemaStore } from "@stores/schemaStore";
import {
  activateConstraintSubTab,
  activateTab,
  getColumnsPanel,
} from "./createTableDialogTestHelpers";

export function resetCreateTableDialogConstraintState() {
  vi.clearAllMocks();
  useConnectionStore.setState({ connections: [] });
  useSafeModeStore.setState({ mode: "off" });
  useQueryHistoryStore.setState({ recentVisible: [] });
  // Reset the schema store cache between tests — AC-229-09's reference
  // table picker reads `useSchemaStore.tables[<conn>:<refSchema>]`.
  useSchemaStore.setState({
    schemas: {},
    tables: {},
    views: {},
    functions: {},
    tableColumnsCache: {},
    loading: false,
    error: null,
  });
}

export function getForeignKeysPanel(): HTMLElement {
  return document.querySelector(
    '[data-testid="create-table-foreign-keys-panel"]',
  ) as HTMLElement;
}

// 2-column form helper: order_id integer / user_id integer on `orders`.
export async function fillTwoColumnFormAndOpenForeignKeysTab() {
  fireEvent.change(screen.getByLabelText("Table name"), {
    target: { value: "orders" },
  });
  const columnsPanel = getColumnsPanel();
  const colNameInputs = within(columnsPanel).getAllByLabelText("Column name");
  fireEvent.change(colNameInputs[0]!, { target: { value: "order_id" } });
  fireEvent.change(
    within(columnsPanel).getAllByLabelText("Column data type")[0]!,
    { target: { value: "integer" } },
  );
  fireEvent.click(screen.getByRole("button", { name: /Add column/i }));
  const inputs2 = within(getColumnsPanel()).getAllByLabelText("Column name");
  fireEvent.change(inputs2[1]!, { target: { value: "user_id" } });
  fireEvent.change(
    within(getColumnsPanel()).getAllByLabelText("Column data type")[1]!,
    { target: { value: "integer" } },
  );
  activateTab("Constraints");
}

// Sprint 241 — Constraints panel has nested sub-tabs; each `+ Add`
// button is hidden behind its family's sub-tab.
export function addFkRow() {
  fireEvent.click(screen.getByRole("button", { name: /Add foreign key/i }));
}

export async function addCheckRow() {
  await activateConstraintSubTab("CHECK");
  fireEvent.click(await screen.findByRole("button", { name: /Add check/i }));
}

export async function addUniqueRow() {
  await activateConstraintSubTab("UNIQUE");
  fireEvent.click(await screen.findByRole("button", { name: /Add unique/i }));
}

export { activateConstraintSubTab, activateTab, getColumnsPanel };
