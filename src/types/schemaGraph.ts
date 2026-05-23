import type { RuntimeRdbmsDatabaseType } from "./rdbmsDataSources";
import type {
  ColumnInfo,
  ConstraintInfo,
  IndexInfo,
  SchemaInfo,
  TableInfo,
} from "./schema";

export interface SchemaGraphSource {
  readonly dbType: RuntimeRdbmsDatabaseType;
  readonly database?: string;
}

export interface SchemaGraphCatalogSnapshot {
  readonly source: SchemaGraphSource;
  readonly schemas: readonly SchemaInfo[];
  readonly tablesBySchema: Readonly<Record<string, readonly TableInfo[]>>;
  readonly columnsByTable: Readonly<
    Record<string, Readonly<Record<string, readonly ColumnInfo[]>>>
  >;
  readonly indexesByTable?: Readonly<
    Record<string, Readonly<Record<string, readonly IndexInfo[]>>>
  >;
  readonly constraintsByTable?: Readonly<
    Record<string, Readonly<Record<string, readonly ConstraintInfo[]>>>
  >;
}

export type SchemaGraphNodeKind =
  | "schema"
  | "table"
  | "column"
  | "index"
  | "constraint";

export interface SchemaGraphNodeBase {
  readonly id: string;
  readonly kind: SchemaGraphNodeKind;
  readonly label: string;
}

export interface SchemaGraphSchemaNode extends SchemaGraphNodeBase {
  readonly kind: "schema";
  readonly schema: string;
  readonly data: SchemaInfo;
}

export interface SchemaGraphTableNode extends SchemaGraphNodeBase {
  readonly kind: "table";
  readonly schema: string;
  readonly table: string;
  readonly data: TableInfo;
}

export interface SchemaGraphColumnNode extends SchemaGraphNodeBase {
  readonly kind: "column";
  readonly schema: string;
  readonly table: string;
  readonly column: string;
  readonly ordinal: number;
  readonly data: ColumnInfo;
}

export interface SchemaGraphIndexNode extends SchemaGraphNodeBase {
  readonly kind: "index";
  readonly schema: string;
  readonly table: string;
  readonly index: string;
  readonly data: IndexInfo;
}

export interface SchemaGraphConstraintPayload {
  readonly name: string;
  readonly constraintType: string;
  readonly columns: readonly string[];
  readonly referenceTable: string | null;
  readonly referenceColumns: readonly string[] | null;
  readonly checkExpression?: string;
  readonly foreignKey?: SchemaGraphForeignKeyRelationship;
  readonly synthetic: boolean;
  readonly data?: ConstraintInfo;
}

export interface SchemaGraphConstraintNode extends SchemaGraphNodeBase {
  readonly kind: "constraint";
  readonly schema: string;
  readonly table: string;
  readonly constraint: string;
  readonly data: SchemaGraphConstraintPayload;
}

export type SchemaGraphNode =
  | SchemaGraphSchemaNode
  | SchemaGraphTableNode
  | SchemaGraphColumnNode
  | SchemaGraphIndexNode
  | SchemaGraphConstraintNode;

export type SchemaGraphEdgeKind =
  | "schema-table"
  | "table-column"
  | "table-index"
  | "index-column"
  | "table-constraint"
  | "constraint-column"
  | "primary-key-column"
  | "foreign-key-table"
  | "foreign-key-column";

export interface SchemaGraphEdge {
  readonly id: string;
  readonly kind: SchemaGraphEdgeKind;
  readonly from: string;
  readonly to: string;
  readonly constraintId?: string;
  readonly columns?: readonly string[];
  readonly referenceColumns?: readonly string[];
  readonly foreignKey?: SchemaGraphForeignKeyRelationship;
}

export interface SchemaGraphForeignKeyEndpoint {
  readonly schema: string;
  readonly table: string;
  readonly columns: readonly string[];
}

export interface SchemaGraphForeignKeyRawMetadata {
  readonly constraintName: string;
  readonly constraintType: string;
  readonly sourceColumns: readonly string[];
  readonly referenceTable: string | null;
  readonly referenceColumns: readonly string[] | null;
  readonly columnReferences: readonly string[];
  readonly synthetic: boolean;
}

export interface SchemaGraphForeignKeyRelationship {
  readonly kind: "foreign-key";
  readonly direction: "source-to-target";
  readonly source: SchemaGraphForeignKeyEndpoint;
  readonly target: SchemaGraphForeignKeyEndpoint;
  readonly rawMetadata: SchemaGraphForeignKeyRawMetadata;
}

export type SchemaGraphDiagnosticKind =
  | "inferred-reference-schema"
  | "invalid-fk-reference"
  | "missing-reference-table"
  | "missing-reference-column"
  | "missing-source-column"
  | "missing-index-column"
  | "missing-constraint-column"
  | "mismatched-fk-column-count"
  | "conflicting-fk-reference";

export interface SchemaGraphDiagnostic {
  readonly id: string;
  readonly kind: SchemaGraphDiagnosticKind;
  readonly severity: "warning";
  readonly subjectId: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, string>>;
}

export interface SchemaGraph {
  readonly source: SchemaGraphSource;
  readonly nodes: readonly SchemaGraphNode[];
  readonly edges: readonly SchemaGraphEdge[];
  readonly diagnostics: readonly SchemaGraphDiagnostic[];
}
