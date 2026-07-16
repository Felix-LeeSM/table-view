# Refactor 02 frontend compatibility inventory

Issue: #734
Parent: #573
Feeds: #742 local frontend SOT, #758 final compatibility ledger

Scope: production compatibility markers under `src/components/**`,
`src/features/**`, `src/lib/**`, `src/stores/**`, and `src/types/**`.
Tests are evidence only.

#734 produced the initial inventory without source behavior changes. #735 moves
connection-owned inventory rows to `src/features/connection/**` after the
connection feature boundary lands. This document tracks those row paths only;
#742 remains the final local frontend SOT follow-up. #736 moves completion-owned
rows to `src/features/completion/**` after the completion feature boundary
lands.

## Verification commands

```bash
rg -n "legacy|fallback|compat|backward|deprecated" src/components src/features src/lib src/stores src/types --glob '*.{ts,tsx}'
rg -n "legacy|deprecated|back-compat|backward compat|backward compatibility|backward-compat|backwards compatibility|backwards-compatible|compat wrapper|compat surface|compatibility[- ]mirror|compatibility projection" src/components src/features src/lib src/stores src/types --glob '*.{ts,tsx}' --glob '!**/*.test.ts' --glob '!**/*.test.tsx' --glob '!**/*.spec.ts' --glob '!**/__tests__/**' --glob '!src/lib/*/wasm/*.d.ts'
pnpm exec tsx scripts/check-eslint-static-policy.ts
```

`fallback` alone is broad: many hits are normal UI/runtime fallbacks, CodeMirror
fallback flags, defensive defaults, or test-only fixtures. The static guard below
tracks production hard-compat markers. Compatibility fallback branches that
preserve old persisted/wire/caller behavior are included in the table.

## Inventory

| Path | Branch | Classification | Owner | Horizon | Tests | Follow-up |
|---|---|---|---|---|---|---|
| `src/features/connection/model.ts` | legacy URL-scheme alias support | permanent-wire-compatibility | connection profile contract | Preserve while URL import/paste accepts historical aliases. | `src/types/connection.test.ts` | #735 preserves connection API, #758 final ledger |
| `src/types/queryLanguage.ts` | TypeScript language fallback metadata mirrors WASM-owned languages | permanent-wire-compatibility | query-language metadata contract | Preserve as loader/runtime fallback while Rust/WASM owns source of truth. | `src/types/queryLanguage.docs.test.ts`<br>`src/types/dataSource.test.ts` | #736 completion boundary, #742 frontend SOT |
| `src/types/query.ts` | legacy QueryResult compatibility projection from typed envelopes | permanent-wire-compatibility | query result envelope boundary | Preserve until native result envelopes replace QueryResult at the renderer boundary. | `src/types/query.resultEnvelope.test.ts` | #737 and #764 query cleanup, #758 ledger |
| `src/types/search.ts` | legacy/composable Search template endpoint union | permanent-wire-compatibility | Search catalog contract | Preserve because Elasticsearch/OpenSearch expose both template families. | `src/components/search/SearchIndexDetailPanel.test.tsx`<br>`src/lib/search/searchDslCompletion.test.ts` | #758 records preservation |
| `src/stores/favoritesStore.ts` | legacy local-storage write semantics around favorites IPC | migration-only | favorites persistence store | Move persistence IPC/compat ownership during workspace/query domain extraction. | `src/stores/favoritesStore.test.ts` | #737 and #740 own domain movement, #758 reconciles |
| `src/stores/mruStore.ts` | lastUsedConnectionId and legacy LS-compatible mutation semantics | migration-only | MRU persistence store | Retire or preserve explicitly when workspace shell migration lands. | `src/stores/mruStore.test.ts` | #740 workspace migration, #758 ledger |
| `src/stores/workspaceStore/persistence.ts` | boot-time import from legacy local-storage workspace payload | migration-only | workspace persistence | Keep through Refactor 02, reconcile in Refactor 05 storage/frontend ledger. | `src/stores/workspaceStore.persistence.test.ts` | #740 movement, #758 removal/preservation |
| `src/stores/workspaceStore/types.ts` | deprecated queryMode field on persisted tabs | migration-only | workspace tab persistence | Remove after query characterization/extraction no longer needs legacy tab mode. | `src/stores/workspaceStore.queryMode.test.ts` | #737 and #764 remove query compatibility paths |
| `src/lib/sql/aliasColumnCompletion.ts` | legacy flat schema-list completion input | migration-only | SQL completion context | Normalize under completion feature boundary. | `src/features/completion/sql/sqlCompletionContext.test.ts` | #736 completion migration, #742 SOT |
| `src/lib/sql/cteColumnCompletion.ts` | legacy flat schema-list completion input | migration-only | SQL completion context | Normalize under completion feature boundary. | `src/features/completion/sql/sqlCompletionContext.test.ts` | #736 completion migration, #742 SOT |
| `src/features/completion/index.ts` | SQL legacy compatibility owner issue export | migration-only | completion public API | Remove exported owner marker when legacy fallback owner #682 closes. | `scripts/__tests__/check-eslint-static-policy.test.ts`<br>`src/features/completion/sql/sqlHybridCompletionSource.test.ts` | #736 completion migration |
| `src/features/completion/sql/sqlHybridCompletionSource.ts` | legacy CodeMirror completion source fallback list | migration-only | SQL completion adapter | Remove when temporary legacy fallback owner #682 is resolved and callers use WASM completion only. | `src/features/completion/sql/sqlHybridCompletionSource.test.ts` | #736 completion migration |
| `src/lib/sql/sqlDialectKeywords.ts` | backwards-compatible keyword helper for legacy completion modules | migration-only | SQL completion vocabulary | Remove helper after completion modules stop importing legacy keyword API. | `src/lib/sql/sqlDialectKeywords.test.ts` | #736 completion migration |
| `src/lib/mongo/mongoCompletionVocabulary.ts` | Mongo completion compatibility mirror before eager WASM load | permanent-wire-compatibility | Mongo completion vocabulary | Preserve as frontend fallback while WASM module load can fail or be delayed. | `src/lib/mongo/mongoCompletionVocabulary.test.ts` | #736 completion boundary, #758 preservation |
| `src/lib/mongo/mongoOperatorMeta.ts` | deprecated BSON symbol metadata retained in completion help | permanent-wire-compatibility | Mongo completion vocabulary | Preserve because BSON/Extended JSON payloads may still expose deprecated symbol values. | `src/lib/mongo/mongoCompletionVocabulary.test.ts` | #736 completion boundary, #758 preservation |
| `src/lib/mongo/mongoShellCompletionVocabulary.ts` | legacy mongosh completion vocabulary facade | migration-only | Mongo shell completion vocabulary | Remove after completion feature API owns Mongo shell suggestions directly. | `src/lib/mongo/mongoCompletionVocabulary.test.ts` | #736 completion migration |
| `src/features/completion/mongo/useMongoAutocomplete.ts` | admin command no-match preserves Phase 28 db collection method whitelist | permanent-wire-compatibility | Mongo completion adapter | Preserve unless final compatibility ledger proves the whitelist can be removed. | `src/features/completion/mongo/useMongoAutocomplete.test.ts` | #736 completion boundary, #758 preservation |
| `src/lib/runtime/migration/legacyColumnPrefsDrop.ts` | one-time legacy column preference cleanup sentinel | removable-debt | storage migration runtime | Eligible for removal only after storage/frontend compatibility ledger closes. | `src/lib/runtime/migration/legacyColumnPrefsDrop.test.ts` | #758 decides removal horizon |
| `src/lib/runtime/history/recordHistoryEntry.ts` | legacy history argument and method-name normalization | permanent-wire-compatibility | query history runtime | Preserve for stored history and backend wire compatibility. | `src/lib/runtime/history/recordHistoryEntry.test.ts` | #737 characterization, #758 preservation |
| `src/lib/runtime/snapshot/loadAll.ts` | legacy snake_case snapshot/theme normalization | permanent-wire-compatibility | snapshot loader | Preserve for existing local snapshots. | `src/lib/runtime/snapshot/loadAll.theme-fallback.test.ts` | #758 storage compatibility |
| `src/lib/datagrid/paradigmEditAdapter.ts` | DocumentDataGrid backward-compatible mqlPreview facade | migration-only | document/result-grid edit adapter | Remove after result-grid/datagrid feature boundary exposes the new adapter contract. | `src/components/datagrid/useDataGridEdit.document.test.ts` | #739 result-grid/datagrid migration |
| `src/lib/strings/paradigm-vocabulary.ts` | legacy RDB English copy anchor | permanent-wire-compatibility | paradigm vocabulary | Preserve to avoid UI copy drift across migrated paradigms. | `src/lib/strings/paradigm-vocabulary.test.ts` | #742 frontend SOT, #758 preservation |
| `src/lib/sql/sqlAstTypes.ts` | SqlWhereExpr backwards-compatible type alias | migration-only | SQL AST facade | Remove after SQL parser/completion consumers import canonical AST names. | `src/lib/sql/sqlAst.test.ts` | #736 and #737 migration |
| `src/lib/sql/sqlLiteral.ts` | legacy SQL literal escape path for unknown families | permanent-wire-compatibility | SQL literal serialization | Preserve as safest fallback for unknown/custom dialect families. | `src/lib/sql/sqlSafety.test.ts` | #758 preservation |
| `src/lib/sql/sqlSafety.ts` | legacy regex safety classifier fallback | permanent-wire-compatibility | SQL Safe Mode classifier | Preserve until parser coverage proves every retained branch can be removed safely. | `src/lib/sql/sqlSafety.test.ts` | #737 characterization, #758 ledger |
| `src/lib/tauri/cancel.ts` | legacy cooperative cancelQuery payload | permanent-wire-compatibility | query cancellation Tauri wrapper | Preserve while backend cancellation command shape is unchanged. | `src/lib/tauri/cancel.test.ts` | #737 query characterization |
| `src/lib/tauri/ddl.ts` | DDL compat wrappers | migration-only | schema mutation Tauri wrapper | Remove positional/compat wrappers after catalog/schema and result-grid migrations update callers. | `src/lib/tauri/ddl.test.ts` | #738 and #739 domain migrations |
| `src/lib/tauri/document.ts` | legacy validator envelope and positional document API args | permanent-wire-compatibility | document Tauri wrapper | Preserve for older backend/test-stub response envelopes until a backend contract issue replaces it. | `src/lib/tauri/document.test.ts`<br>`src/components/document/__tests__/ValidatorPanel.sprint352.test.tsx` | #758 preservation unless backend contract child replaces it |
| `src/lib/tauri/legacyImport.ts` | legacy local-storage import IPC wrapper | permanent-wire-compatibility | storage import runtime | Preserve as upgrade/import wire compatibility until lifecycle is reconciled. | `src/lib/tauri/legacyImport.test.ts` | #758 decides preservation/removal |
| `src/lib/tauri/meta_sentinel.ts` | legacy import and column-pref sentinels | permanent-wire-compatibility | storage metadata wrapper | Preserve while local metadata rows can contain legacy sentinel keys. | `src/lib/tauri/legacyImport.test.ts`<br>`src/lib/runtime/migration/legacyColumnPrefsDrop.test.ts` | #758 storage compatibility |
| `src/lib/tauri/numericWrap.ts` | legacy data_type numeric metadata normalization | permanent-wire-compatibility | document metadata wrapper | Preserve while backend/test fixtures may emit legacy snake_case. | `src/lib/tauri/numericWrap.test.ts` | #758 preservation |
| `src/lib/window-label.ts` | legacy single workspace window label | migration-only | window router | Remove after workspace shell/window feature migration confirms no legacy label producers remain. | `src/lib/window-label.test.ts` | #740 workspace migration |
| `src/features/connection/components/ConnectionDialog/useConnectionDraftForm.ts` | legacy URL/default-port draft behavior | permanent-wire-compatibility | connection dialog draft form | Preserve through connection migration because it protects imported/manual connection drafts. | `src/features/connection/components/ConnectionDialog.urlInput.test.tsx` | #735 preserves behavior |
| `src/features/connection/components/ConnectionGroup.tsx` | legacy color-null group accent fallback | permanent-wire-compatibility | connection group list | Preserve while existing group rows can have `color=null`. | `src/features/connection/components/ConnectionGroup.test.tsx` | #735 preserves connection UI behavior, #758 preservation |
| `src/features/connection/components/ImportExportDialog.tsx` | backward-compatible connection import envelope behavior | permanent-wire-compatibility | connection import/export UI | Preserve for exported/imported connection envelopes. | `src/features/connection/components/ImportExportDialog.ac149.test.tsx` | #735 migration, #758 preservation |
| `src/components/structure/SqlPreviewDialog.tsx` | optional footer label for legacy callers | migration-only | structure preview dialog | Remove optional caller compatibility after schema mutation dialogs move behind feature API. | `src/components/schema/SchemaTree.actions.test.tsx` | #738 catalog/schema migration |
| `src/components/structure/ColumnsEditor.tsx` | legacy caller coordinates/vocabulary props | migration-only | columns editor | Remove after schema structure editor callers route through catalog/schema feature API. | `src/components/structure/ColumnsEditor.test.tsx` | #738 catalog/schema migration |
| `src/components/query/QueryTab.tsx` | legacy queryMode/history panel compatibility | migration-only | query tab container | Remove after query feature cleanup and public API enforcement. | `src/components/query/QueryTab.lifecycle.test.tsx`<br>`src/stores/workspaceStore.queryMode.test.ts` | #737 and #764 query cleanup |
| `src/components/query/QueryTab/useQueryExecution.ts` | legacy queryMode and history filter compatibility | migration-only | query execution hook | Remove after persisted workspace tabs no longer carry queryMode and query history filters no longer read legacy modes. | `src/components/query/QueryTab/useQueryExecution.parserDispatch.test.tsx`<br>`src/components/query/QueryTab/useQueryExecution.runCommand.test.tsx` | #741 and #742 own final boundary/SOT cleanup |
| `src/components/query/QueryTab/Toolbar.tsx` | loadQueryIntoTab backward-compatible store action | migration-only | query toolbar | Remove after query feature public API owns load behavior. | `src/components/query/QueryTab.lifecycle.test.tsx` | #737 and #764 query cleanup |
| `src/components/query/QueryTab/TabDbChip.tsx` | legacy chip self-hide behavior | migration-only | query tab chip | Recheck during query/workspace feature split. | `src/components/query/QueryTab.lifecycle.test.tsx` | #737 and #740 split ownership |
| `src/components/query/QueryLog.tsx` | legacy entries read and clear-dialog compatibility | migration-only | query log panel | Remove after query history feature API replaces embedded compatibility reads. | `src/components/query/QueryLog.test.tsx` | #737 and #764 query cleanup |
| `src/components/query/QueryResultGrid.tsx` | legacy single-statement/grid result rendering dispatch | migration-only | query result renderer | Remove after result-grid/datagrid migration owns typed renderer API. | `src/components/query/QueryResultGrid.test.tsx` | #739 result-grid/datagrid migration |
| `src/components/shared/QuerySyntax.tsx` | legacy undefined paradigm syntax fallback | migration-only | shared query syntax renderer | Remove after feature callers pass explicit paradigm/language. | `src/components/shared/QuerySyntax.test.tsx` | #737 and #742 frontend SOT |
| `src/components/workspace/DbSwitcher.tsx` | legacy table-tab schema fallback | migration-only | workspace database switcher | Remove after workspace feature migration resolves database identity through typed state. | `src/components/workspace/DbSwitcher.test.tsx` | #740 workspace migration |
| `src/components/layout/MainArea.tsx` | legacy schema/table aliasing for persisted tabs | migration-only | workspace main area | Remove after workspace tab model migration updates persisted tab readers. | `src/components/layout/MainArea.test.tsx` | #740 workspace migration |
| `src/components/layout/useTabDrag.ts` | legacy WebKit/jsdom dataTransfer fallback | permanent-wire-compatibility | tab drag interaction | Preserve browser/runtime compatibility unless drag implementation changes. | `src/components/layout/TabBar.test.tsx` | #740 workspace interaction boundary |
| `src/components/ui/dialog.tsx` | legacy dialog slot/header compatibility | migration-only | dialog primitive | Remove only after migrated dialogs stop depending on old slot arrangement. | `src/features/connection/components/ConnectionDialog.test.tsx` | #735 and #738 migrate callers, #742 UI API |
| `src/components/ui/ExecuteButton.tsx` | legacy regression-test id override | removable-debt | execute button primitive | Remove when tests stop requiring the legacy test id hook. | `src/components/workspace/ConfirmDestructiveDialog.test.tsx` | #742 and #758 decide cleanup |
| `src/components/workspace/ConfirmDestructiveDialog.tsx` | legacy plain Confirm affordance default | migration-only | destructive confirmation dialog | Remove after all call sites pass explicit command labels through feature APIs. | `src/components/query/QueryTab.warn-dialog.test.tsx` | #737 and #740 migration |
| `src/components/schema/AddColumnDialog.tsx` | workspace database optional prop for back-compat | migration-only | schema add-column dialog | Remove after catalog/schema feature migration updates callers. | `src/components/schema/CreateTableDialog.test.tsx` | #738 catalog/schema migration |
| `src/components/schema/DropColumnDialog.tsx` | workspace database optional prop for back-compat | migration-only | schema drop-column dialog | Remove after catalog/schema feature migration updates callers. | `src/components/schema/StructurePanel.overview.test.tsx` | #738 catalog/schema migration |
| `src/components/schema/CreateTableDialog/useCreateTableForm.ts` | legacy caller omission of optional availableSchemas | migration-only | create-table dialog form hook | Remove after catalog/schema feature dialog slots pass availableSchemas explicitly. | `src/components/schema/CreateTableDialog.test.tsx` | #738 catalog/schema migration |
| `src/components/schema/CreateTableTypeCombobox.tsx` | Sprint 230 back-compatible type combobox rendering | migration-only | create-table type combobox | Recheck when catalog/schema feature owns type input contract. | `src/components/schema/CreateTableDialog.test.tsx` | #738 catalog/schema migration |
| `src/components/schema/CreateTableDialog/ForeignKeysTabBody.tsx` | legacy single-toggle props for old FK/UNIQUE checkbox UI | migration-only | create-table constraints tab | Remove after catalog/schema feature callers use ordered-column arrays only. | `src/components/schema/CreateTableDialog/ForeignKeysTabBody.test.tsx` | #738 catalog/schema migration |
| `src/components/schema/CreateTableDialog/IndexesTabBody.tsx` | legacy single-toggle prop for old index checkbox UI | migration-only | create-table indexes tab | Remove after catalog/schema feature callers use ordered-column arrays only. | `src/components/schema/CreateTableDialog/IndexesTabBody.test.tsx` | #738 catalog/schema migration |
| `src/components/schema/SchemaTree.tsx` | legacy minimal confirm-dialog slot compatibility | migration-only | schema tree | Remove after schema tree actions/dialogs move behind feature API. | `src/components/schema/SchemaTree.actions.test.tsx` | #738 catalog/schema migration |
| `src/components/schema/SchemaTree/dialogs.tsx` | legacy dialog mount slots | migration-only | schema tree dialogs | Remove after schema tree dialog API is replaced by feature boundary. | `src/components/schema/SchemaTree.actions.test.tsx` | #738 catalog/schema migration |
| `src/components/schema/SchemaTree/rows.tsx` | legacy root-level flat indentation | migration-only | schema tree rows | Recheck after catalog/schema model migration resolves root kinds explicitly. | `src/components/schema/SchemaTree.dbms-shape.test.tsx` | #738 catalog/schema migration |
| `src/components/schema/SchemaTree/useSchemaTreeActions.ts` | legacy action state slots and drop-table opener | migration-only | schema tree actions | Remove after catalog/schema feature action API owns dialog state. | `src/components/schema/SchemaTree.actions.test.tsx` | #738 catalog/schema migration |
| `src/components/document/MqlPreviewModal.tsx` | optional footer label for legacy callers | migration-only | document preview modal | Remove after document/query feature callers pass explicit labels. | `src/components/document/MqlPreviewModal.test.tsx` | #737 and #762 query migration |
| `src/components/document/ValidatorPanel.tsx` | legacy validator response normalizer | permanent-wire-compatibility | document validator panel | Preserve until backend/test stubs cannot emit pre-envelope validator responses. | `src/components/document/__tests__/ValidatorPanel.sprint352.test.tsx` | #758 preservation ledger |
| `src/components/shared/BsonTreeViewer.tsx` | legacy BSON binary companion keys | permanent-wire-compatibility | BSON tree renderer | Preserve while existing document payloads can contain legacy Extended JSON shapes. | `src/components/shared/BsonTreeViewer.test.tsx` | #758 preservation ledger |
| `src/components/datagrid/DataGridTable/columnUtils.ts` | legacy schema.table(column) parser | migration-only | data-grid column utilities | Remove after result-grid/datagrid feature contract exposes structured column refs. | `src/components/datagrid/DataGridTable.fk-navigation.test.tsx` | #739 result-grid/datagrid migration |
| `src/components/datagrid/sqlGenerator.ts` | legacy all-column fallback disabled plus back-compatible wrapper | migration-only | data-grid SQL generator | Remove wrapper after data-grid edit callers use key-aware generator directly. | `src/components/datagrid/sqlGenerator.test.ts` | #739 result-grid/datagrid migration |

## Follow-up issue coverage

No new GitHub issues are required from this inventory. Migration-only rows are
covered by existing same-milestone Refactor 02 child issues (#735 through #742
and #761 through #764). Permanent wire compatibility and removable-debt rows can
feed the downstream compatibility ledger #758. #734 does not remove behavior.
#735 updates connection row paths after the connection feature boundary lands;
#742 remains the final local frontend SOT follow-up.

## Static guard

`scripts/check-eslint-static-policy.ts` parses the table above and fails when:

- A production hard-compat marker under this inventory scope is missing from
  this table.
- A table row is stale, outside scope, lacks owner/horizon/test evidence, or lacks
  a follow-up issue reference.
- A `migration-only` row lacks a same-milestone Refactor 02 follow-up issue
  reference (#735 through #742 or #761 through #764).
- A classification is not one of `permanent-wire-compatibility`,
  `migration-only`, or `removable-debt`.
