import { describe, expect, it } from "vitest";
import {
  CATALOG_FEATURE_PUBLIC_API_EXPORTS,
  CATALOG_FEATURE_PUBLIC_API_PATH,
  findCatalogFeatureBoundaryViolations,
} from "../check-eslint-static-policy";

function catalogPublicApiFixture(extraLines: readonly string[] = []) {
  return [
    'export { default as SchemaTree } from "@components/schema/SchemaTree";',
    'export { default as DocumentDatabaseTree } from "@components/schema/DocumentDatabaseTree";',
    'export { default as StructurePanel } from "@components/schema/StructurePanel";',
    'export { default as ViewStructurePanel } from "@components/schema/ViewStructurePanel";',
    'export { default as SchemaErdPanel } from "@components/schema/SchemaErdPanel";',
    'export { default as AddColumnDialog } from "@components/schema/AddColumnDialog";',
    'export { default as DropColumnDialog } from "@components/schema/DropColumnDialog";',
    'export { default as OrderedColumnPicker } from "@components/schema/CreateTableDialog/OrderedColumnPicker";',
    'export { registerSchemaDbMismatchRecoveryHandler, useSchemaStore } from "@stores/schemaStore";',
    'export type { SchemaDbMismatchRecoveryHandler } from "@stores/schemaStore";',
    'export { extractSchemaGraph } from "@/lib/schemaGraph";',
    'export { buildSchemaGraphCatalogSnapshot } from "@/lib/schemaGraphSnapshot";',
    "export type { AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnChange, ColumnDefinition, ColumnInfo, ConstraintDefinition, ConstraintInfo, CreateIndexRequest, CreateTablePlanConstraint, CreateTablePlanIndex, CreateTablePlanRequest, CreateTableRequest, CreateTriggerRequest, DropColumnRequest, DropConstraintRequest, DropIndexRequest, DropTableRequest, DropTriggerRequest, FilterCondition, FilterMode, FilterOperator, FunctionInfo, IndexInfo, PostgresExtensionInfo, PostgresTypeInfo, RenameTableRequest, SchemaChangeResult, SchemaInfo, SortInfo, TableData, TableInfo, TriggerInfo, ViewInfo } from '@/types/schema';",
    "export type { SchemaGraph, SchemaGraphCatalogSnapshot, SchemaGraphColumnNode, SchemaGraphConstraintNode, SchemaGraphConstraintPayload, SchemaGraphDiagnostic, SchemaGraphDiagnosticKind, SchemaGraphEdge, SchemaGraphEdgeKind, SchemaGraphForeignKeyEndpoint, SchemaGraphForeignKeyRawMetadata, SchemaGraphForeignKeyRelationship, SchemaGraphIndexNode, SchemaGraphNode, SchemaGraphNodeBase, SchemaGraphNodeKind, SchemaGraphSchemaNode, SchemaGraphSource, SchemaGraphTableNode } from '@/types/schemaGraph';",
    ...extraLines,
  ].join("\n");
}

describe("catalog feature static policy", () => {
  it("locks the public API surface", () => {
    expect(CATALOG_FEATURE_PUBLIC_API_EXPORTS).toEqual([
      "SchemaTree",
      "DocumentDatabaseTree",
      "StructurePanel",
      "ViewStructurePanel",
      "SchemaErdPanel",
      "AddColumnDialog",
      "DropColumnDialog",
      "OrderedColumnPicker",
      "registerSchemaDbMismatchRecoveryHandler",
      "useSchemaStore",
      "SchemaDbMismatchRecoveryHandler",
      "extractSchemaGraph",
      "buildSchemaGraphCatalogSnapshot",
      "AddColumnRequest",
      "AddConstraintRequest",
      "AlterTableRequest",
      "ColumnChange",
      "ColumnDefinition",
      "ColumnInfo",
      "ConstraintDefinition",
      "ConstraintInfo",
      "CreateIndexRequest",
      "CreateTablePlanConstraint",
      "CreateTablePlanIndex",
      "CreateTablePlanRequest",
      "CreateTableRequest",
      "CreateTriggerRequest",
      "DropColumnRequest",
      "DropConstraintRequest",
      "DropIndexRequest",
      "DropTableRequest",
      "DropTriggerRequest",
      "FilterCondition",
      "FilterMode",
      "FilterOperator",
      "FunctionInfo",
      "IndexInfo",
      "PostgresExtensionInfo",
      "PostgresTypeInfo",
      "RenameTableRequest",
      "SchemaChangeResult",
      "SchemaInfo",
      "SortInfo",
      "TableData",
      "TableInfo",
      "TriggerInfo",
      "ViewInfo",
      "SchemaGraph",
      "SchemaGraphCatalogSnapshot",
      "SchemaGraphColumnNode",
      "SchemaGraphConstraintNode",
      "SchemaGraphConstraintPayload",
      "SchemaGraphDiagnostic",
      "SchemaGraphDiagnosticKind",
      "SchemaGraphEdge",
      "SchemaGraphEdgeKind",
      "SchemaGraphForeignKeyEndpoint",
      "SchemaGraphForeignKeyRawMetadata",
      "SchemaGraphForeignKeyRelationship",
      "SchemaGraphIndexNode",
      "SchemaGraphNode",
      "SchemaGraphNodeBase",
      "SchemaGraphNodeKind",
      "SchemaGraphSchemaNode",
      "SchemaGraphSource",
      "SchemaGraphTableNode",
    ]);
  });

  it("rejects catalog/schema UI imports from migrated legacy paths", () => {
    const failures = findCatalogFeatureBoundaryViolations(
      new Map([
        [CATALOG_FEATURE_PUBLIC_API_PATH, catalogPublicApiFixture()],
        [
          "src/components/layout/MainArea.tsx",
          'import StructurePanel from "@components/schema/StructurePanel";\n',
        ],
        [
          "src/components/workspace/RdbSidebar.tsx",
          'import SchemaTree from "@/components/schema/SchemaTree";\n',
        ],
      ]),
    );

    expect(failures).toContain(
      "src/components/layout/MainArea.tsx: import catalog/schema UI through src/features/catalog/index.ts, not @components/schema/StructurePanel.",
    );
    expect(failures).toContain(
      "src/components/workspace/RdbSidebar.tsx: import catalog/schema UI through src/features/catalog/index.ts, not @/components/schema/SchemaTree.",
    );
  });

  it("accepts migrated catalog/schema public API imports", () => {
    const failures = findCatalogFeatureBoundaryViolations(
      new Map([
        [CATALOG_FEATURE_PUBLIC_API_PATH, catalogPublicApiFixture()],
        [
          "src/components/layout/MainArea.tsx",
          'import { StructurePanel, ViewStructurePanel, SchemaErdPanel } from "@features/catalog";\n',
        ],
        [
          "src/components/workspace/DocumentSidebar.tsx",
          'import { DocumentDatabaseTree } from "@features/catalog";\n',
        ],
      ]),
    );

    expect(failures).toEqual([]);
  });

  it("rejects unexpected public API exports", () => {
    const failures = findCatalogFeatureBoundaryViolations(
      new Map([
        [
          CATALOG_FEATURE_PUBLIC_API_PATH,
          catalogPublicApiFixture([
            "export { internalCatalogFixture } from './testSupport';",
          ]),
        ],
      ]),
    );

    expect(failures).toContain(
      `${CATALOG_FEATURE_PUBLIC_API_PATH}: unexpected public export internalCatalogFixture.`,
    );
  });
});
