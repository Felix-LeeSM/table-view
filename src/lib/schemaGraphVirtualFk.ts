/**
 * Virtual foreign keys — relationships the user draws by hand, kept as a
 * first-class model instead of a drawing (ADR 0055).
 *
 * A link is `{ source, targets[], discriminator? }`. `targets` is plural from
 * the start so a polymorphic association (Rails-style `commentable_id` +
 * `commentable_type`) is expressible without retro-fitting a single-target
 * model, and `discriminator` names the source column that decides which target
 * a row points at.
 *
 * Everything here is pure: links come from persistence
 * (`src/stores/erdVirtualFkStore.ts`), the graph comes from the catalog, and
 * this module projects one onto the other. It never writes.
 */

import type { SchemaName, TableName } from "@/types/branded";
import type {
  SchemaGraph,
  SchemaGraphEdge,
  SchemaGraphVirtualForeignKeyRelationship,
} from "@/types/schemaGraph";
import { schemaGraphColumnId, schemaGraphTableId } from "./schemaGraphSupport";

/** `SchemaGraphEdgeKind` carried by every drawn arm of a virtual FK. */
export const VIRTUAL_FOREIGN_KEY_EDGE_KIND = "virtual-foreign-key-table";

export interface VirtualForeignKeyEndpoint {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
}

export interface VirtualForeignKeyLink {
  readonly id: string;
  readonly source: VirtualForeignKeyEndpoint;
  /** More than one target means the link is polymorphic. */
  readonly targets: readonly VirtualForeignKeyEndpoint[];
  /** Source column naming which target a row points at. Optional (ADR 0055). */
  readonly discriminator?: string;
}

/**
 * Relationship kinds an ERD edge can have. The kind must be readable without
 * colour vision, so {@link ERD_RELATIONSHIP_ENCODINGS} carries no colour: the
 * canvas keeps its own palette and this table decides line pattern, arrow head
 * and legend wording on top of it (issue #1663, ADR 0055 "색 단독 인코딩 금지").
 */
export type ErdRelationshipKind = "foreign-key" | "virtual-foreign-key";

export interface ErdRelationshipEncoding {
  /** SVG `stroke-dasharray`. `null` draws the solid line real FKs use. */
  readonly strokeDasharray: string | null;
  /** Arrow head at the referenced end — a shape difference, not a tint. */
  readonly marker: "arrowclosed" | "arrow";
  /** `schema` namespace i18n key naming this kind in the legend. */
  readonly legendKey: string;
}

export const ERD_RELATIONSHIP_ENCODINGS: Readonly<
  Record<ErdRelationshipKind, ErdRelationshipEncoding>
> = {
  "foreign-key": {
    strokeDasharray: null,
    marker: "arrowclosed",
    legendKey: "erdLegendForeignKey",
  },
  "virtual-foreign-key": {
    strokeDasharray: "6 4",
    marker: "arrow",
    legendKey: "erdLegendVirtualForeignKey",
  },
};

/**
 * Reconcile against the current schema (ADR 0056 (3)): a link only draws while
 * every endpoint it uses still exists. A target whose column is gone is pruned,
 * a link left without a source or without any target draws nothing, and a
 * discriminator that no longer exists is dropped while the link survives.
 *
 * ponytail: pruning is a projection, never a write. A graph whose columns have
 * not been fetched yet is indistinguishable from a dropped column, so deleting
 * stored links from here would destroy hand-drawn work on a slow metadata
 * fetch. Unresolved links stay in storage and reappear when the table does —
 * revisit only if dead links pile up enough to be worth a user-visible prune.
 */
export function reconcileVirtualForeignKeys(
  links: readonly VirtualForeignKeyLink[],
  graph: SchemaGraph,
): readonly VirtualForeignKeyLink[] {
  const columnIds = new Set(
    graph.nodes.filter((node) => node.kind === "column").map((node) => node.id),
  );
  const exists = (endpoint: VirtualForeignKeyEndpoint) =>
    columnIds.has(endpointColumnId(endpoint));

  return links.flatMap((link) => {
    if (!exists(link.source)) return [];
    const targets = link.targets.filter(exists);
    if (targets.length === 0) return [];
    const discriminatorExists =
      link.discriminator !== undefined &&
      columnIds.has(
        endpointColumnId({ ...link.source, column: link.discriminator }),
      );
    return [
      {
        id: link.id,
        source: link.source,
        targets,
        ...(discriminatorExists ? { discriminator: link.discriminator } : {}),
      },
    ];
  });
}

/**
 * One edge per surviving target, so a polymorphic link renders as a fan out of
 * the one source table (ADR 0055).
 */
export function virtualForeignKeyEdges(
  links: readonly VirtualForeignKeyLink[],
  graph: SchemaGraph,
): readonly SchemaGraphEdge[] {
  const edges = new Map<string, SchemaGraphEdge>();
  for (const link of reconcileVirtualForeignKeys(links, graph)) {
    const polymorphic = link.targets.length > 1;
    for (const target of link.targets) {
      const relationship: SchemaGraphVirtualForeignKeyRelationship = {
        kind: "virtual-foreign-key",
        linkId: link.id,
        source: endpointRef(link.source),
        target: endpointRef(target),
        ...(link.discriminator === undefined
          ? {}
          : { discriminator: link.discriminator }),
        polymorphic,
      };
      const id = `edge:${VIRTUAL_FOREIGN_KEY_EDGE_KIND}:${link.id}->${endpointColumnId(target)}`;
      // Keyed by id, so a duplicated target or a duplicated link id collapses
      // instead of handing React Flow two edges with the same key.
      edges.set(id, {
        id,
        kind: VIRTUAL_FOREIGN_KEY_EDGE_KIND,
        from: endpointTableId(link.source),
        to: endpointTableId(target),
        columns: [link.source.column],
        referenceColumns: [target.column],
        virtualForeignKey: relationship,
      });
    }
  }
  return [...edges.values()].sort((left, right) =>
    left.id.localeCompare(right.id, "en"),
  );
}

/** The catalog graph plus the virtual FK edges the current schema can draw. */
export function applyVirtualForeignKeys(
  graph: SchemaGraph,
  links: readonly VirtualForeignKeyLink[],
): SchemaGraph {
  const edges = virtualForeignKeyEdges(links, graph);
  if (edges.length === 0) return graph;
  return { ...graph, edges: [...graph.edges, ...edges] };
}

export function virtualForeignKeyLabel(
  relationship: SchemaGraphVirtualForeignKeyRelationship,
): string {
  const { source, target, discriminator } = relationship;
  const via = discriminator ? ` via ${discriminator}` : "";
  return `${source.schema}.${source.table}.${source.columns.join(", ")} virtually references ${target.schema}.${target.table}.${target.columns.join(", ")}${via}`;
}

/**
 * Persisted value -> links. Trust boundary: the JSON comes out of SQLite, which
 * a downgrade or a hand edit can leave in any shape. Returns `null` when the
 * caller should keep what it has (absent key, not JSON, not an array); an empty
 * array is a real answer — a user who removed every link must get none back.
 * Malformed entries are dropped one by one so one bad row cannot lose the rest.
 */
export function parseVirtualForeignKeyLinks(
  raw: string,
): VirtualForeignKeyLink[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.flatMap((entry) => {
    const link = toLink(entry);
    return link ? [link] : [];
  });
}

function toLink(entry: unknown): VirtualForeignKeyLink | null {
  if (typeof entry !== "object" || entry === null) return null;
  const candidate = entry as Record<string, unknown>;
  const id = candidate.id;
  const source = toEndpoint(candidate.source);
  if (typeof id !== "string" || id === "" || !source) return null;
  if (!Array.isArray(candidate.targets)) return null;
  const targets = candidate.targets.flatMap((target) => {
    const endpoint = toEndpoint(target);
    return endpoint ? [endpoint] : [];
  });
  if (targets.length === 0) return null;
  const discriminator = candidate.discriminator;
  return {
    id,
    source,
    targets,
    ...(typeof discriminator === "string" && discriminator !== ""
      ? { discriminator }
      : {}),
  };
}

function toEndpoint(value: unknown): VirtualForeignKeyEndpoint | null {
  if (typeof value !== "object" || value === null) return null;
  const { schema, table, column } = value as Record<string, unknown>;
  if (typeof schema !== "string" || schema === "") return null;
  if (typeof table !== "string" || table === "") return null;
  if (typeof column !== "string" || column === "") return null;
  return { schema, table, column };
}

// Stored links are plain JSON, so the schema/table axes are branded here — the
// same one-place assertion `collectTables` makes at the catalog boundary.
function endpointColumnId(endpoint: VirtualForeignKeyEndpoint): string {
  return schemaGraphColumnId(
    endpoint.schema as SchemaName,
    endpoint.table as TableName,
    endpoint.column,
  );
}

function endpointTableId(endpoint: VirtualForeignKeyEndpoint): string {
  return schemaGraphTableId(
    endpoint.schema as SchemaName,
    endpoint.table as TableName,
  );
}

function endpointRef(endpoint: VirtualForeignKeyEndpoint) {
  return {
    schema: endpoint.schema as SchemaName,
    table: endpoint.table as TableName,
    columns: [endpoint.column],
  };
}
