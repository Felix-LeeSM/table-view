export { default as SchemaTree } from "@components/schema/SchemaTree";
export { default as DocumentDatabaseTree } from "@components/schema/DocumentDatabaseTree";
export { default as StructurePanel } from "@components/schema/StructurePanel";
export { default as ViewStructurePanel } from "@components/schema/ViewStructurePanel";
export { default as SchemaErdPanel } from "@components/schema/SchemaErdPanel";
export { default as AddColumnDialog } from "@components/schema/AddColumnDialog";
export { default as DropColumnDialog } from "@components/schema/DropColumnDialog";
export { default as OrderedColumnPicker } from "@components/schema/CreateTableDialog/OrderedColumnPicker";

export {
  registerSchemaDbMismatchRecoveryHandler,
  useSchemaStore,
} from "@stores/schemaStore";
export type { SchemaDbMismatchRecoveryHandler } from "@stores/schemaStore";

// SchemaGraph extraction stays shared-library owned; catalog exposes the contract.
export { extractSchemaGraph } from "@/lib/schemaGraph";
export { buildSchemaGraphCatalogSnapshot } from "@/lib/schemaGraphSnapshot";
export type {
  AddColumnRequest,
  AddConstraintRequest,
  AlterTableRequest,
  ColumnChange,
  ColumnDefinition,
  ColumnInfo,
  ConstraintDefinition,
  ConstraintInfo,
  CreateIndexRequest,
  CreateTablePlanConstraint,
  CreateTablePlanIndex,
  CreateTablePlanRequest,
  CreateTableRequest,
  CreateTriggerRequest,
  DropColumnRequest,
  DropConstraintRequest,
  DropIndexRequest,
  DropTableRequest,
  DropTriggerRequest,
  FilterCondition,
  FilterMode,
  FilterOperator,
  FunctionInfo,
  IndexInfo,
  PostgresExtensionInfo,
  PostgresTypeInfo,
  RenameTableRequest,
  SchemaChangeResult,
  SchemaInfo,
  SortInfo,
  TableData,
  TableInfo,
  TriggerInfo,
  ViewInfo,
} from "@/types/schema";
export type {
  SchemaGraph,
  SchemaGraphCatalogSnapshot,
  SchemaGraphColumnNode,
  SchemaGraphConstraintNode,
  SchemaGraphConstraintPayload,
  SchemaGraphDiagnostic,
  SchemaGraphDiagnosticKind,
  SchemaGraphEdge,
  SchemaGraphEdgeKind,
  SchemaGraphForeignKeyEndpoint,
  SchemaGraphForeignKeyRawMetadata,
  SchemaGraphForeignKeyRelationship,
  SchemaGraphIndexNode,
  SchemaGraphNode,
  SchemaGraphNodeBase,
  SchemaGraphNodeKind,
  SchemaGraphSchemaNode,
  SchemaGraphSource,
  SchemaGraphTableNode,
} from "@/types/schemaGraph";
