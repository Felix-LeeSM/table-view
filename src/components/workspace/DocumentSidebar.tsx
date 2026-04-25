import DocumentDatabaseTree from "@components/schema/DocumentDatabaseTree";

export interface DocumentSidebarProps {
  /** Connection whose database/collection tree should be displayed. */
  connectionId: string;
}

/**
 * Sprint 126 — paradigm-specific sidebar for document connections
 * (currently MongoDB).
 *
 * Symmetrical to {@link RdbSidebar}: a thin wrapper that lets the
 * paradigm slot resolve to a concrete tree component without taking a
 * direct dependency on `DocumentDatabaseTree`. Future document-only
 * controls (database picker, collection search) belong here.
 */
export default function DocumentSidebar({
  connectionId,
}: DocumentSidebarProps) {
  return <DocumentDatabaseTree connectionId={connectionId} />;
}
