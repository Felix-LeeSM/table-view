import SchemaTree from "@components/schema/SchemaTree";

export interface RdbSidebarProps {
  /** Connection whose schema tree should be displayed. */
  connectionId: string;
}

/**
 * Sprint 126 — paradigm-specific sidebar for relational connections.
 *
 * Today this is a thin wrapper around the existing {@link SchemaTree}
 * (the RDB schema browser). The wrapper exists so paradigm slot consumers
 * (`<WorkspaceSidebar>`) can route by paradigm without knowing the
 * concrete tree component. Future RDB-only chrome (toolbar, filters)
 * lands here without leaking into the document path.
 */
export default function RdbSidebar({ connectionId }: RdbSidebarProps) {
  return <SchemaTree connectionId={connectionId} />;
}
