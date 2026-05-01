// AC-189-06c — paradigm-agnostic data grid policy.
// `DEFAULT_PAGE_SIZE` was duplicated as a local const in
// `components/rdb/DataGrid.tsx` and `components/document/DocumentDataGrid.tsx`
// (both `300`). Single source so RDB and Document grids stay aligned.
export const DEFAULT_PAGE_SIZE = 300;
