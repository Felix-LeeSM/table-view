// #1370 — leaf type module for the schemaGraph selector facade. Extracted from
// `schemaGraphSelectors.ts` to break the type<->value cross-import cycle:
// `schemaGraphSelectors` (value) re-exports `schemaGraphMigrationImpact`, which
// in turn needed selector types back from it. Both now import these pure types
// from this leaf (no runtime deps beyond `@/types/schemaGraph`).
import type {
  SchemaGraph,
  SchemaGraphColumnNode,
  SchemaGraphConstraintNode,
  SchemaGraphDiagnostic,
  SchemaGraphForeignKeyRelationship,
  SchemaGraphIndexNode,
  SchemaGraphSchemaNode,
  SchemaGraphTableNode,
} from "@/types/schemaGraph";

export type SchemaGraphMetadataField = "columns" | "indexes" | "constraints";
export type SchemaGraphMetadataFieldState = "available" | "missing" | "unknown";
export type SchemaGraphMetadataStatus =
  | "ready"
  | "partial"
  | "missing"
  | "unknown";

export interface SchemaGraphNodeMaps {
  readonly schemasById: ReadonlyMap<string, SchemaGraphSchemaNode>;
  readonly tablesById: ReadonlyMap<string, SchemaGraphTableNode>;
  readonly columnsById: ReadonlyMap<string, SchemaGraphColumnNode>;
  readonly indexesById: ReadonlyMap<string, SchemaGraphIndexNode>;
  readonly constraintsById: ReadonlyMap<string, SchemaGraphConstraintNode>;
  readonly columnsByTableId: ReadonlyMap<
    string,
    readonly SchemaGraphColumnNode[]
  >;
  readonly indexesByTableId: ReadonlyMap<
    string,
    readonly SchemaGraphIndexNode[]
  >;
  readonly constraintsByTableId: ReadonlyMap<
    string,
    readonly SchemaGraphConstraintNode[]
  >;
}

export interface SchemaGraphForeignKeySelection {
  readonly edgeId: string;
  readonly constraintId: string;
  readonly relationship: SchemaGraphForeignKeyRelationship;
  readonly sourceTableId: string;
  readonly targetTableId: string;
  readonly sourceColumnIds: readonly string[];
  readonly targetColumnIds: readonly string[];
}

export interface SchemaGraphTableForeignKeys {
  readonly tableId: string;
  readonly incomingForeignKeys: readonly SchemaGraphForeignKeySelection[];
  readonly outgoingForeignKeys: readonly SchemaGraphForeignKeySelection[];
}

export interface SchemaGraphForeignKeySelectors {
  readonly foreignKeys: readonly SchemaGraphForeignKeySelection[];
  readonly foreignKeysByConstraintId: ReadonlyMap<
    string,
    SchemaGraphForeignKeySelection
  >;
  readonly foreignKeysByTableId: ReadonlyMap<
    string,
    SchemaGraphTableForeignKeys
  >;
}

export interface SchemaGraphTableMetadataReadiness {
  readonly tableId: string;
  readonly schema: string;
  readonly table: string;
  readonly source: "catalog-snapshot" | "schema-graph";
  readonly status: SchemaGraphMetadataStatus;
  readonly ready: boolean;
  readonly columns: SchemaGraphMetadataFieldState;
  readonly indexes: SchemaGraphMetadataFieldState;
  readonly constraints: SchemaGraphMetadataFieldState;
  readonly missing: readonly SchemaGraphMetadataField[];
  readonly diagnostics: readonly SchemaGraphDiagnostic[];
}

export interface SchemaGraphIntelligenceSelectors extends SchemaGraphNodeMaps {
  readonly graph: SchemaGraph;
  readonly diagnostics: readonly SchemaGraphDiagnostic[];
  readonly diagnosticsBySubjectId: ReadonlyMap<
    string,
    readonly SchemaGraphDiagnostic[]
  >;
  readonly foreignKeys: readonly SchemaGraphForeignKeySelection[];
  readonly foreignKeysByConstraintId: ReadonlyMap<
    string,
    SchemaGraphForeignKeySelection
  >;
  readonly foreignKeysByTableId: ReadonlyMap<
    string,
    SchemaGraphTableForeignKeys
  >;
  readonly metadataReadinessByTableId: ReadonlyMap<
    string,
    SchemaGraphTableMetadataReadiness
  >;
}
