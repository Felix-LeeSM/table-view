import {
  useDataGridEdit,
  type DataGridEditState,
  type UseDataGridEditParams,
} from "./useDataGridEdit";

export type UseRdbDataGridEditParams = Omit<UseDataGridEditParams, "paradigm">;

export function useRdbDataGridEdit(
  params: UseRdbDataGridEditParams,
): DataGridEditState {
  return useDataGridEdit({ ...params, paradigm: "rdb" });
}
