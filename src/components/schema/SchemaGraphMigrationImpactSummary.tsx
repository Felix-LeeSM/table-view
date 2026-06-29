import { useTranslation } from "react-i18next";
import { AlertTriangle, GitBranch, KeyRound } from "lucide-react";
import type {
  SchemaGraphForeignKeySelection,
  SchemaGraphMigrationImpactSummary as MigrationImpactSummary,
  SchemaGraphTableMetadataReadiness,
} from "@/lib/schemaGraphSelectors";
import type {
  SchemaGraphColumnNode,
  SchemaGraphConstraintNode,
  SchemaGraphIndexNode,
  SchemaGraphTableNode,
} from "@/types/schemaGraph";

interface SchemaGraphMigrationImpactSummaryProps {
  impact: MigrationImpactSummary | null | undefined;
}

export default function SchemaGraphMigrationImpactSummary({
  impact,
}: SchemaGraphMigrationImpactSummaryProps) {
  const { t } = useTranslation("schema");
  if (!impact) return null;

  const total =
    impact.affectedTables.length +
    impact.affectedColumns.length +
    impact.affectedIndexes.length +
    impact.affectedConstraints.length +
    impact.foreignKeys.length;
  const metadataNotice = formatMetadataNotice(impact.metadataReadiness);

  return (
    <section
      aria-label={`Migration impact for ${impact.targetLabel}`}
      className="rounded border border-border bg-muted/20 px-3 py-2"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch size={13} className="shrink-0 text-muted-foreground" />
          <h3 className="truncate text-xs font-semibold text-foreground">
            {t("migrationImpact")}
          </h3>
          <span className="truncate text-3xs text-muted-foreground">
            {impact.targetLabel}
          </span>
        </div>
        <span className="text-3xs text-muted-foreground">
          {t("schemaGraphSummary")}
        </span>
      </div>

      {!impact.targetFound ? (
        <p className="rounded border border-dashed border-border bg-background px-2 py-2 text-xs text-muted-foreground">
          {t("targetNotFound")}
        </p>
      ) : null}

      {impact.targetFound && total === 0 ? (
        <p className="rounded border border-dashed border-border bg-background px-2 py-2 text-xs text-muted-foreground">
          {t("noDependentMetadata")}
        </p>
      ) : null}

      {metadataNotice ? (
        <div
          role="status"
          className="mb-2 flex items-start gap-2 rounded border border-border bg-background px-2 py-1.5 text-3xs text-muted-foreground"
        >
          <AlertTriangle
            size={12}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-amber-600"
          />
          <span>{metadataNotice}</span>
        </div>
      ) : null}

      <div className="grid gap-2 lg:grid-cols-2">
        <ImpactList
          title={t("impactTables")}
          rows={impact.affectedTables}
          render={formatTable}
        />
        <ImpactList
          title={t("impactColumns")}
          rows={impact.affectedColumns}
          render={formatColumn}
        />
        <ImpactList
          title={t("impactIndexes")}
          rows={impact.affectedIndexes}
          render={formatIndex}
        />
        <ImpactList
          title={t("impactConstraints")}
          rows={impact.affectedConstraints}
          render={formatConstraint}
        />
      </div>

      <div className="mt-2 rounded border border-border bg-background px-2 py-2">
        <div className="mb-1 flex items-center gap-1 text-3xs font-semibold uppercase text-muted-foreground">
          <KeyRound size={11} aria-hidden="true" />
          {t("foreignKeys")}
        </div>
        {impact.foreignKeys.length > 0 ? (
          <ul className="space-y-1">
            {impact.foreignKeys.map((foreignKey) => (
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
                  {formatForeignKeyTitle(foreignKey)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-3xs text-muted-foreground">
            {t("noDependentForeignKeys")}
          </p>
        )}
      </div>

      {impact.diagnostics.length > 0 ? (
        <div className="mt-2 rounded border border-border bg-background px-2 py-2">
          <div className="mb-1 flex items-center gap-1 text-3xs font-semibold uppercase text-muted-foreground">
            <AlertTriangle size={11} aria-hidden="true" />
            {t("diagnostics")}
          </div>
          <ul className="space-y-1 text-3xs text-muted-foreground">
            {impact.diagnostics.map((diagnostic) => (
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

function ImpactList<T>({
  title,
  rows,
  render,
}: {
  title: string;
  rows: readonly T[];
  render: (row: T) => string;
}) {
  const { t } = useTranslation("schema");
  return (
    <div className="min-w-0 rounded border border-border bg-background px-2 py-2">
      <div className="mb-1 text-3xs font-semibold uppercase text-muted-foreground">
        {title}
      </div>
      {rows.length > 0 ? (
        <ul className="space-y-1">
          {rows.map((row) => {
            const label = render(row);
            return (
              <li
                key={label}
                className="truncate rounded bg-muted/30 px-2 py-1 text-3xs text-muted-foreground"
                title={label}
              >
                {label}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-3xs text-muted-foreground">{t("none")}</p>
      )}
    </div>
  );
}

function formatTable(table: SchemaGraphTableNode): string {
  return `${table.schema}.${table.table}`;
}

function formatColumn(column: SchemaGraphColumnNode): string {
  return `${column.schema}.${column.table}.${column.column}`;
}

function formatIndex(index: SchemaGraphIndexNode): string {
  return `${index.schema}.${index.table}.${index.index} (${formatColumns(
    index.data.columns,
  )})`;
}

function formatConstraint(constraint: SchemaGraphConstraintNode): string {
  return `${constraint.schema}.${constraint.table}.${constraint.constraint} (${
    constraint.data.constraintType
  } on ${formatColumns(constraint.data.columns)})`;
}

function formatForeignKeyTitle(
  foreignKey: SchemaGraphForeignKeySelection,
): string {
  return `${formatEndpoint(foreignKey.relationship.source)} -> ${formatEndpoint(
    foreignKey.relationship.target,
  )}`;
}

function formatEndpoint(
  endpoint: SchemaGraphForeignKeySelection["relationship"]["source"],
): string {
  return `${endpoint.schema}.${endpoint.table} (${formatColumns(
    endpoint.columns,
  )})`;
}

function formatColumns(columns: readonly string[]): string {
  return columns.length > 0 ? columns.join(", ") : "no columns";
}

function formatMetadataNotice(
  readiness: readonly SchemaGraphTableMetadataReadiness[],
): string | null {
  const incomplete = readiness.filter(
    (metadata) => metadata.status !== "ready",
  );
  if (incomplete.length === 0) return null;
  const missing = [
    ...new Set(incomplete.flatMap((metadata) => metadata.missing)),
  ];
  if (missing.length === 0) {
    return "Impact metadata readiness unknown for this graph.";
  }
  return `Impact metadata incomplete: missing ${missing.join(", ")}.`;
}
