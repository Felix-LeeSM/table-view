import { AlertTriangle, KeyRound, Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  SchemaGraphForeignKeySelection,
  SchemaGraphTableForeignKeys,
  SchemaGraphTableMetadataReadiness,
} from "@/lib/schemaGraphSelectors";
import type {
  SchemaGraphConstraintNode,
  SchemaGraphIndexNode,
  SchemaGraphTableNode,
} from "@/types/schemaGraph";

interface SchemaErdDependencyViewProps {
  table: SchemaGraphTableNode;
  foreignKeys?: SchemaGraphTableForeignKeys;
  indexes: readonly SchemaGraphIndexNode[];
  constraints: readonly SchemaGraphConstraintNode[];
  metadata?: SchemaGraphTableMetadataReadiness;
  tableLabel: string;
}

/**
 * Read-only dependency panel under the ERD canvas. Split out of the old
 * hand-rolled renderer unchanged — the React Flow swap (#1655) replaces how the
 * diagram is drawn, not what the selected table reports.
 */
export default function SchemaErdDependencyView({
  table,
  foreignKeys,
  indexes,
  constraints,
  metadata,
  tableLabel,
}: SchemaErdDependencyViewProps) {
  const { t } = useTranslation("schema");
  const incoming = foreignKeys?.incomingForeignKeys ?? [];
  const outgoing = foreignKeys?.outgoingForeignKeys ?? [];
  const hasDependencyRows = incoming.length > 0 || outgoing.length > 0;
  const hasMetadataRows = indexes.length > 0 || constraints.length > 0;
  const metadataNotice = formatMetadataNotice(metadata);

  return (
    <section
      aria-label={`Dependencies for ${table.schema}.${table.table}`}
      className="max-h-56 overflow-auto border-t border-border bg-muted/20 px-3 py-2"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link2 size={13} className="shrink-0 text-muted-foreground" />
          <h2 className="truncate text-xs font-semibold text-foreground">
            {t("dependencies")}
          </h2>
          <span className="truncate text-3xs text-muted-foreground">
            {tableLabel}
          </span>
        </div>
        <span className="text-3xs text-muted-foreground">
          {t("readOnlySchemaGraphView")}
        </span>
      </div>

      {metadataNotice && (
        <div
          role="status"
          className="mb-2 flex items-start gap-2 rounded border border-border bg-background px-2 py-1.5 text-3xs text-muted-foreground"
        >
          <AlertTriangle
            size={12}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-warning"
          />
          <span>{metadataNotice}</span>
        </div>
      )}

      {!hasDependencyRows && !hasMetadataRows && (
        <div className="rounded border border-dashed border-border bg-background px-2 py-2 text-xs text-muted-foreground">
          {t("noDependenciesForTable")}
        </div>
      )}

      <div className="grid gap-2 lg:grid-cols-2">
        <ForeignKeyGroup title={t("incoming")} foreignKeys={incoming} />
        <ForeignKeyGroup title={t("outgoing")} foreignKeys={outgoing} />
      </div>

      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        <IndexGroup indexes={indexes} />
        <ConstraintGroup constraints={constraints} />
      </div>

      {metadata?.diagnostics.length ? (
        <div className="mt-2 rounded border border-border bg-background px-2 py-2">
          <div className="mb-1 flex items-center gap-1 text-3xs font-semibold uppercase text-muted-foreground">
            <AlertTriangle size={11} aria-hidden="true" />
            {t("schemaGraphDiagnostics")}
          </div>
          <ul className="space-y-1 text-3xs text-muted-foreground">
            {metadata.diagnostics.map((diagnostic) => (
              <li key={diagnostic.id} className="min-w-0">
                <span className="font-medium text-foreground">
                  {diagnostic.kind}
                </span>
                <span>: {diagnostic.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ForeignKeyGroup({
  title,
  foreignKeys,
}: {
  title: string;
  foreignKeys: readonly SchemaGraphForeignKeySelection[];
}) {
  const { t } = useTranslation("schema");
  return (
    <div className="min-w-0 rounded border border-border bg-background px-2 py-2">
      <div className="mb-1 flex items-center gap-1 text-3xs font-semibold uppercase text-muted-foreground">
        <KeyRound size={11} aria-hidden="true" />
        {title}
      </div>
      {foreignKeys.length > 0 ? (
        <ul className="space-y-1">
          {foreignKeys.map((foreignKey) => (
            <li
              key={foreignKey.edgeId}
              className="min-w-0 rounded bg-muted/30 px-2 py-1 text-3xs text-muted-foreground"
            >
              <div className="truncate font-medium text-foreground">
                {foreignKey.relationship.rawMetadata.constraintName}
              </div>
              <div
                className="truncate"
                title={formatForeignKeyTitle(foreignKey)}
              >
                {formatTableEndpoint(foreignKey.relationship.source)} {"->"}{" "}
                {formatTableEndpoint(foreignKey.relationship.target)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-3xs text-muted-foreground">
          {t("noFks", { direction: title.toLowerCase() })}
        </p>
      )}
    </div>
  );
}

function IndexGroup({ indexes }: { indexes: readonly SchemaGraphIndexNode[] }) {
  const { t } = useTranslation("schema");
  return (
    <div className="min-w-0 rounded border border-border bg-background px-2 py-2">
      <div className="mb-1 text-3xs font-semibold uppercase text-muted-foreground">
        {t("relatedIndexes")}
      </div>
      {indexes.length > 0 ? (
        <ul className="space-y-1">
          {indexes.map((index) => (
            <li
              key={index.id}
              className="min-w-0 rounded bg-muted/30 px-2 py-1 text-3xs"
            >
              <div className="truncate font-medium text-foreground">
                {index.index}
              </div>
              <div className="truncate text-muted-foreground">
                {formatIndexFlags(index)} on {formatColumns(index.data.columns)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-3xs text-muted-foreground">
          {t("noRelatedIndexes")}
        </p>
      )}
    </div>
  );
}

function ConstraintGroup({
  constraints,
}: {
  constraints: readonly SchemaGraphConstraintNode[];
}) {
  const { t } = useTranslation("schema");
  return (
    <div className="min-w-0 rounded border border-border bg-background px-2 py-2">
      <div className="mb-1 text-3xs font-semibold uppercase text-muted-foreground">
        {t("constraintsTab")}
      </div>
      {constraints.length > 0 ? (
        <ul className="space-y-1">
          {constraints.map((constraint) => (
            <li
              key={constraint.id}
              className="min-w-0 rounded bg-muted/30 px-2 py-1 text-3xs"
            >
              <div className="flex min-w-0 items-center gap-1">
                <span className="truncate font-medium text-foreground">
                  {constraint.constraint}
                </span>
                <span className="shrink-0 rounded bg-secondary px-1 text-3xs text-muted-foreground">
                  {constraint.data.constraintType}
                </span>
              </div>
              <div className="truncate text-muted-foreground">
                {formatColumns(constraint.data.columns)}
              </div>
              {constraint.data.checkExpression && (
                <div
                  className="truncate font-mono text-3xs text-muted-foreground"
                  title={constraint.data.checkExpression}
                >
                  {constraint.data.checkExpression}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-3xs text-muted-foreground">{t("noConstraints")}</p>
      )}
    </div>
  );
}

function formatMetadataNotice(
  metadata: SchemaGraphTableMetadataReadiness | undefined,
): string | null {
  if (!metadata || metadata.status === "ready") return null;
  if (metadata.status === "unknown") {
    return "Metadata readiness unknown for this graph.";
  }
  if (metadata.missing.length === 0) {
    return "Dependency metadata may be incomplete.";
  }
  return `Dependency metadata incomplete: missing ${metadata.missing.join(
    ", ",
  )}.`;
}

function formatIndexFlags(index: SchemaGraphIndexNode): string {
  const flags = [
    index.data.is_primary ? "primary" : null,
    index.data.is_unique ? "unique" : null,
    index.data.index_type || "index",
  ].filter(Boolean);
  return flags.join(" ");
}

function formatColumns(columns: readonly string[]): string {
  return columns.length > 0 ? columns.join(", ") : "no columns";
}

function formatTableEndpoint(
  endpoint: SchemaGraphForeignKeySelection["relationship"]["source"],
): string {
  return `${endpoint.schema}.${endpoint.table} (${formatColumns(
    endpoint.columns,
  )})`;
}

function formatForeignKeyTitle(
  foreignKey: SchemaGraphForeignKeySelection,
): string {
  return `${formatTableEndpoint(
    foreignKey.relationship.source,
  )} -> ${formatTableEndpoint(foreignKey.relationship.target)}`;
}
