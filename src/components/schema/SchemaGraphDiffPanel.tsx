import { GitCompareArrows } from "lucide-react";
import type {
  SchemaGraphDiffChangeKind,
  SchemaGraphDiffEntry,
  SchemaGraphDiffSummary,
} from "@/lib/schemaGraphDiff";

interface SchemaGraphDiffPanelProps {
  diff: SchemaGraphDiffSummary | null | undefined;
}

export default function SchemaGraphDiffPanel({
  diff,
}: SchemaGraphDiffPanelProps) {
  if (!diff) return null;

  const added = entriesForKind(diff, "added");
  const removed = entriesForKind(diff, "removed");
  const changed = entriesForKind(diff, "changed");

  return (
    <section
      role="region"
      aria-label="Schema diff"
      className="rounded border border-border bg-muted/20 px-3 py-2"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <GitCompareArrows
            size={13}
            className="shrink-0 text-muted-foreground"
          />
          <h2 className="truncate text-xs font-semibold text-foreground">
            Schema diff
          </h2>
          <span className="truncate text-3xs text-muted-foreground">
            {formatSource(diff.source.before)} {"->"}{" "}
            {formatSource(diff.source.after)}
          </span>
        </div>
        <span className="text-3xs text-muted-foreground">
          read-only cached SchemaGraph diff
        </span>
      </div>

      {diff.totals.total === 0 ? (
        <div
          role="status"
          className="rounded border border-dashed border-border bg-background px-2 py-2 text-xs text-muted-foreground"
        >
          No schema differences found in cached SchemaGraph snapshots.
        </div>
      ) : (
        <div className="grid gap-2 lg:grid-cols-3">
          <DiffBucket title="Added" kind="added" entries={added} />
          <DiffBucket title="Removed" kind="removed" entries={removed} />
          <DiffBucket title="Changed" kind="changed" entries={changed} />
        </div>
      )}
    </section>
  );
}

function DiffBucket({
  title,
  kind,
  entries,
}: {
  title: string;
  kind: SchemaGraphDiffChangeKind;
  entries: readonly SchemaGraphDiffEntry[];
}) {
  return (
    <div className="min-w-0 rounded border border-border bg-background px-2 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-3xs font-semibold uppercase text-muted-foreground">
          {title}
        </h3>
        <span className="text-3xs tabular-nums text-muted-foreground">
          {entries.length}
        </span>
      </div>
      {entries.length > 0 ? (
        <ul aria-label={`${title} schema changes`} className="space-y-1">
          {entries.map((entry) => (
            <li
              key={`${entry.kind}:${entry.entityKind}:${entry.id}`}
              className="min-w-0 rounded bg-muted/30 px-2 py-1 text-3xs text-muted-foreground"
            >
              <div className="flex min-w-0 items-center gap-1">
                <span className="truncate font-medium text-foreground">
                  {entry.label}
                </span>
                <span className="shrink-0 rounded bg-secondary px-1 text-3xs text-muted-foreground">
                  {formatEntityKind(entry.entityKind)}
                </span>
              </div>
              {kind === "changed" && entry.changes.length > 0 ? (
                <ul className="mt-1 space-y-0.5">
                  {entry.changes.map((change) => (
                    <li key={change.field} className="truncate">
                      <span className="font-medium text-foreground">
                        {change.field}
                      </span>
                      : {change.before} {"->"} {change.after}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-3xs text-muted-foreground">None.</p>
      )}
    </div>
  );
}

function entriesForKind(
  diff: SchemaGraphDiffSummary,
  kind: SchemaGraphDiffChangeKind,
): readonly SchemaGraphDiffEntry[] {
  return [
    ...diff.groups.tables[kind],
    ...diff.groups.columns[kind],
    ...diff.groups.indexes[kind],
    ...diff.groups.constraints[kind],
    ...diff.groups.foreignKeys[kind],
  ].sort((left, right) => left.label.localeCompare(right.label, "en"));
}

function formatSource(source: SchemaGraphDiffSummary["source"]["before"]) {
  if (source.label && source.database) {
    return `${source.label}/${source.database}`;
  }
  return source.database
    ? `${source.dbType}/${source.database}`
    : source.dbType;
}

function formatEntityKind(kind: SchemaGraphDiffEntry["entityKind"]) {
  switch (kind) {
    case "foreign-key":
      return "FK";
    case "table":
      return "table";
    case "column":
      return "column";
    case "index":
      return "index";
    case "constraint":
      return "constraint";
  }
}
