import {
  type DataGridEditState,
  type UseDataGridEditParams,
  useDataGridEdit,
} from "./useDataGridEdit";

export type UseDocumentDataGridEditParams = Omit<
  UseDataGridEditParams,
  "paradigm"
>;

export function useDocumentDataGridEdit(
  params: UseDocumentDataGridEditParams,
): DataGridEditState {
  return useDataGridEdit({ ...params, paradigm: "document" });
}
