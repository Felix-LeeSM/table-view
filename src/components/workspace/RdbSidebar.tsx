import { SchemaTree } from "@features/catalog";

export interface RdbSidebarProps {
  /** Connection whose schema tree should be displayed. */
  connectionId: string;
}

/**
 * Paradigm-specific sidebar for relational connections — thin wrapper
 * around {@link SchemaTree}. Exists so paradigm slot consumers
 * (`<WorkspaceSidebar>`) can route by paradigm without knowing the concrete
 * tree component. Future RDB-only chrome (toolbar, filters) lands here
 * without leaking into the document path.
 */
export default function RdbSidebar({ connectionId }: RdbSidebarProps) {
  return <SchemaTree connectionId={connectionId} />;
}
