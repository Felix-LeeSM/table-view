import {
  useDataGridEdit,
  type DataGridEditState,
  type UseDataGridEditParams,
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
