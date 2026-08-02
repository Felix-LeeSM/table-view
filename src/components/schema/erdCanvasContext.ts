import type { Node } from "@xyflow/react";
import { createContext, useContext } from "react";
import type { ErdTableModel } from "./erdGraphModel";

export const ERD_TABLE_NODE_TYPE = "erdTable";

/**
 * React Flow node for one table. The payload stays empty on purpose: table
 * columns and metadata keep arriving after first paint (SchemaErdPanel fetches
 * indexes/constraints per table), and rebuilding every node object for that
 * would fight the drag positions React Flow holds in the same objects. The node
 * reads its content from {@link ErdCanvasContext} instead, so only positions
 * live in node state.
 */
export type ErdTableFlowNode = Node<Record<string, never>, "erdTable">;

export interface ErdCanvasView {
  readonly tablesById: ReadonlyMap<string, ErdTableModel>;
  readonly selectedTableId: string | null;
  /** Tables one FK hop from the selection. Empty while nothing is selected. */
  readonly relatedTableIds: ReadonlySet<string>;
  /** `null` while the search box is empty — every table counts as a match. */
  readonly searchMatchTableIds: ReadonlySet<string> | null;
  readonly onToggleSelect: (tableId: string) => void;
  readonly registerTableButton: (
    tableId: string,
    element: HTMLButtonElement | null,
  ) => void;
}

const EMPTY_VIEW: ErdCanvasView = {
  tablesById: new Map(),
  selectedTableId: null,
  relatedTableIds: new Set(),
  searchMatchTableIds: null,
  onToggleSelect: () => {},
  registerTableButton: () => {},
};

export const ErdCanvasContext = createContext<ErdCanvasView>(EMPTY_VIEW);

export function useErdCanvasView(): ErdCanvasView {
  return useContext(ErdCanvasContext);
}
