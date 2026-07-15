// #1445 — shared virtualization tuning for the sidebar / document trees
// (BsonTreeViewer, DocumentDatabaseTree). SchemaTree keeps its own
// `VIRTUALIZE_THRESHOLD` / `ROW_HEIGHT_ESTIMATE` in `SchemaTree/treeRows.ts`
// because its rows are a different height and its tests pin those values.
//
// Above `TREE_VIRTUALIZE_THRESHOLD` visible rows, rendering is handed off to
// `@tanstack/react-virtual` so a 10k-element array / collection list only
// mounts a viewport-sized window instead of the whole flat list (which would
// hang the tab). `react-virtual` measures real row heights after first paint
// via `measureElement`, so the estimate only governs the initial layout.
export const TREE_VIRTUALIZE_THRESHOLD = 200;
export const TREE_ROW_HEIGHT_ESTIMATE = 24;
