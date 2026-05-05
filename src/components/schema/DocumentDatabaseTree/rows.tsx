import {
  ChevronDown,
  ChevronRight,
  Database as DbIcon,
  FileText,
  Loader2,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@components/ui/context-menu";
import { cn } from "@lib/utils";
import type { CollectionInfo, DatabaseInfo } from "@/types/document";

/**
 * Leaf row renderers for `DocumentDatabaseTree`. Plain props in, no store
 * reads — mirrors `SchemaTree/rows.tsx`.
 */

export interface DatabaseRowProps {
  db: DatabaseInfo;
  isExpanded: boolean;
  isLoading: boolean;
  isSelected: boolean;
  onToggle: () => void;
}

export function DatabaseRow({
  db,
  isExpanded,
  isLoading,
  isSelected,
  onToggle,
}: DatabaseRowProps) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full cursor-pointer items-center gap-1 px-3 py-1 text-xs font-medium hover:bg-muted",
        isSelected ? "bg-muted text-foreground" : "text-secondary-foreground",
      )}
      aria-expanded={isExpanded}
      aria-label={`${db.name} database`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {isExpanded ? (
        <ChevronDown size={12} className="shrink-0" />
      ) : (
        <ChevronRight size={12} className="shrink-0" />
      )}
      <DbIcon size={12} className="shrink-0 text-muted-foreground" />
      <span className="truncate">{db.name}</span>
      {isLoading && <Loader2 size={10} className="ml-auto animate-spin" />}
    </button>
  );
}

export interface CollectionRowProps {
  database: string;
  collection: CollectionInfo;
  isSelected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onDoubleOpen: () => void;
  onRequestDrop: () => void;
}

export function CollectionRow({
  collection,
  isSelected,
  onSelect,
  onOpen,
  onDoubleOpen,
  onRequestDrop,
}: CollectionRowProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full cursor-pointer items-center gap-1.5 py-0.5 pr-3 pl-8 hover:bg-muted",
            isSelected
              ? "bg-primary/10 text-primary font-semibold"
              : "text-foreground",
          )}
          aria-label={`${collection.name} collection`}
          // Single-click opens a preview tab; double-click promotes it to a
          // persistent tab. Same model as the relational tree.
          onClick={() => {
            onSelect();
            onOpen();
          }}
          onDoubleClick={onDoubleOpen}
          onKeyDown={(e) => {
            if (e.key === "Enter") onOpen();
          }}
        >
          <FileText size={12} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-xs">{collection.name}</span>
          {collection.document_count != null && (
            <span className="ml-auto text-3xs text-muted-foreground">
              {collection.document_count.toLocaleString()}
            </span>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem danger onSelect={onRequestDrop}>
          Drop Collection
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
