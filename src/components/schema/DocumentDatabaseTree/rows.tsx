import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Database as DbIcon,
  FileText,
  KeyRound,
  Loader2,
  Lock,
  Settings2,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@components/ui/context-menu";
import { cn } from "@lib/utils";
import {
  isMongoSystemDatabase,
  type CollectionInfo,
  type DatabaseInfo,
} from "@/types/document";

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
  // Sprint 330 (Slice DB-Scope.3) — sidebar 우클릭 entry-point. TabDbChip
  // popover (Sprint 329) 가 가리키는 그 액션. 클릭한 row 의 database 로
  // prefilled mongosh query tab 을 생성한다.
  onNewQueryHere: () => void;
}

export function DatabaseRow({
  db,
  isExpanded,
  isLoading,
  isSelected,
  onToggle,
  onNewQueryHere,
}: DatabaseRowProps) {
  const { t } = useTranslation("schema");
  // Sprint 346 — admin/config/local 은 사용자가 평소 안 건드림. italic +
  // muted opacity 로 시각 구분 (선택/펼침 동작은 동일).
  const isSystem = isMongoSystemDatabase(db.name);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full cursor-pointer items-center gap-1 px-3 py-1 text-xs font-medium hover:bg-muted",
            isSelected
              ? "bg-muted text-foreground"
              : "text-secondary-foreground",
            isSystem && "italic opacity-60",
          )}
          aria-expanded={isExpanded}
          aria-label={t("databaseRowAria", { name: db.name })}
          data-system-db={isSystem ? "true" : undefined}
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
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onNewQueryHere}>
          {t("newQueryHere")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
  const { t } = useTranslation("schema");
  const hasOptions = Object.keys(collection.options).length > 0;
  const hasIdIndex = collection.id_index !== null;
  const showType = collection.collection_type !== "collection";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full min-w-0 cursor-pointer items-center gap-1.5 py-0.5 pr-3 pl-8 text-left hover:bg-muted",
            isSelected
              ? "bg-primary/10 text-primary font-semibold"
              : "text-foreground",
          )}
          aria-label={t("collectionRowAria", { name: collection.name })}
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
          <span className="min-w-0 truncate text-xs leading-5">
            {collection.name}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-3xs text-muted-foreground">
            {showType && (
              <span
                aria-label={t("collectionTypeAria", {
                  name: collection.name,
                  type: collection.collection_type,
                })}
                className="font-medium uppercase"
                title={t("collectionTypeTitle", {
                  type: collection.collection_type,
                })}
              >
                {collection.collection_type}
              </span>
            )}
            {collection.read_only && (
              <span
                aria-label={t("collectionReadOnlyAria", {
                  name: collection.name,
                })}
                role="img"
                title={t("collectionReadOnlyTitle")}
              >
                <Lock size={10} aria-hidden="true" />
              </span>
            )}
            {hasOptions && (
              <span
                aria-label={t("collectionOptionsAria", {
                  name: collection.name,
                })}
                role="img"
                title={t("collectionOptionsTitle")}
              >
                <Settings2 size={10} aria-hidden="true" />
              </span>
            )}
            {hasIdIndex && (
              <span
                aria-label={t("collectionIdIndexAria", {
                  name: collection.name,
                })}
                role="img"
                title={t("collectionIdIndexTitle")}
              >
                <KeyRound size={10} aria-hidden="true" />
              </span>
            )}
            {collection.document_count != null && (
              <span
                aria-label={t("collectionDocCountAria", {
                  name: collection.name,
                  count: collection.document_count,
                })}
              >
                {collection.document_count.toLocaleString()}
              </span>
            )}
          </span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem danger onSelect={onRequestDrop}>
          {t("dropCollection")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
