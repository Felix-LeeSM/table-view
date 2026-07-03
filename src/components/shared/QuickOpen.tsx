import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Table2, Eye, Code2, Terminal, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@components/ui/dialog";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { resolveRdbTreeShape } from "@components/schema/treeShape";
import { useCurrentWindowConnectionId } from "@hooks/useCurrentWindowConnectionId";
import { rankQuickOpen, type RankableFields } from "./quickOpenRanking";

type QuickOpenItemKind = "schema" | "table" | "view" | "function" | "procedure";

interface QuickOpenItem extends RankableFields {
  kind: QuickOpenItemKind;
  name: string;
  schema: string;
  connectionId: string;
  connectionName: string;
  /** Optional source code for functions/procedures. */
  source?: string | null;
}

const KIND_ICON: Record<QuickOpenItemKind, typeof Table2> = {
  schema: Folder,
  table: Table2,
  view: Eye,
  function: Code2,
  procedure: Terminal,
};

export default function QuickOpen() {
  const { t } = useTranslation("shared");
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const KIND_LABEL: Record<QuickOpenItemKind, string> = {
    schema: t("quickOpen.kindSchema"),
    table: t("quickOpen.kindTable"),
    view: t("quickOpen.kindView"),
    function: t("quickOpen.kindFunction"),
    procedure: t("quickOpen.kindProcedure"),
  };

  const schemas = useSchemaStore((s) => s.schemas);
  const tables = useSchemaStore((s) => s.tables);
  const views = useSchemaStore((s) => s.views);
  const functions = useSchemaStore((s) => s.functions);
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  // The connection whose SchemaTree this window's sidebar renders. Schema
  // results are scoped to it because reveal (expand + scroll) only lands on the
  // *mounted* tree — offering another window's schema would be an invisible
  // no-op. `null` outside a workspace window (launcher / jsdom) → no schema
  // results, matching the sidebar showing no tree there.
  const sidebarConnId = useCurrentWindowConnectionId();

  // Build the searchable inventory from every connected schema's cached objects.
  // Sprint 263 — schemaStore is now `(connId, db, schema)` nested. QuickOpen
  // surfaces objects from each connection's *activeDb* only (cross-db search
  // would need parallel pre-fetch and is out of scope for this sprint).
  const items = useMemo<QuickOpenItem[]>(() => {
    const result: QuickOpenItem[] = [];

    for (const conn of connections) {
      const status = activeStatuses[conn.id];
      if (status?.type !== "connected") continue;
      const db = status.activeDb;
      if (!db) continue;

      // Shape drives cross-DBMS behavior: `flat` (SQLite/DuckDB) has no schema
      // layer, so `.`-queries degrade to plain matching and no schema results
      // are offered. `with-schema` (PG) has a focusable schema row to reveal;
      // `no-schema` (MySQL) scopes `.` to its database but has no schema row.
      const shape = resolveRdbTreeShape(conn.dbType);
      const hasSchema = shape !== "flat";
      // Precompute the connection name once; per-object lowercasing happens
      // below so ranking never re-lowercases on every keystroke.
      const connLower = conn.name.toLowerCase();

      // Schemas are first-class results only for the connection this window's
      // sidebar actually renders (`with-schema` + the mounted tree), so a
      // selected schema always reveals visibly instead of no-op'ing.
      if (shape === "with-schema" && conn.id === sidebarConnId) {
        for (const s of schemas[conn.id]?.[db] ?? []) {
          const nameLower = s.name.toLowerCase();
          result.push({
            kind: "schema",
            name: s.name,
            schema: s.name,
            connectionId: conn.id,
            connectionName: conn.name,
            nameLower,
            schemaLower: nameLower,
            connLower,
            hasSchema,
          });
        }
      }

      const tablesBySchema = tables[conn.id]?.[db] ?? {};
      for (const list of Object.values(tablesBySchema)) {
        for (const t of list) {
          result.push({
            kind: "table",
            name: t.name,
            schema: t.schema,
            connectionId: conn.id,
            connectionName: conn.name,
            nameLower: t.name.toLowerCase(),
            schemaLower: t.schema.toLowerCase(),
            connLower,
            hasSchema,
          });
        }
      }

      const viewsBySchema = views[conn.id]?.[db] ?? {};
      for (const list of Object.values(viewsBySchema)) {
        for (const v of list) {
          result.push({
            kind: "view",
            name: v.name,
            schema: v.schema,
            connectionId: conn.id,
            connectionName: conn.name,
            nameLower: v.name.toLowerCase(),
            schemaLower: v.schema.toLowerCase(),
            connLower,
            hasSchema,
          });
        }
      }

      const functionsBySchema = functions[conn.id]?.[db] ?? {};
      for (const list of Object.values(functionsBySchema)) {
        for (const f of list) {
          const kind: QuickOpenItemKind =
            f.kind === "procedure" ? "procedure" : "function";
          result.push({
            kind,
            name: f.name,
            schema: f.schema,
            connectionId: conn.id,
            connectionName: conn.name,
            source: f.source,
            nameLower: f.name.toLowerCase(),
            schemaLower: f.schema.toLowerCase(),
            connLower,
            hasSchema,
          });
        }
      }
    }
    return result;
  }, [
    schemas,
    tables,
    views,
    functions,
    connections,
    activeStatuses,
    sidebarConnId,
  ]);

  useEffect(() => {
    const handler = () => {
      setSearch("");
      setActiveIndex(0);
      setIsOpen(true);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    };
    window.addEventListener("quick-open", handler);
    return () => window.removeEventListener("quick-open", handler);
  }, []);

  // Deterministic ranking + subsequence fuzzy + `schema.name` scoping. Empty
  // query returns the inventory unchanged. See quickOpenRanking.ts.
  const filtered = useMemo(() => rankQuickOpen(items, search), [items, search]);

  const handleClose = () => {
    setIsOpen(false);
    setSearch("");
  };

  const handleSelect = (item: QuickOpenItem) => {
    if (item.kind === "schema") {
      // Reveal the schema in the sidebar tree (expand + focus/scroll). The
      // mounted SchemaTree for this connection consumes the event; see
      // SchemaTree.tsx's `reveal-schema` listener.
      window.dispatchEvent(
        new CustomEvent("reveal-schema", {
          detail: { connectionId: item.connectionId, schema: item.schema },
        }),
      );
    } else if (item.kind === "function" || item.kind === "procedure") {
      // Open in a new query tab with the function source pre-filled
      window.dispatchEvent(
        new CustomEvent("quickopen-function", {
          detail: {
            connectionId: item.connectionId,
            source: item.source ?? "",
            title: `${item.schema}.${item.name}`,
          },
        }),
      );
    } else {
      window.dispatchEvent(
        new CustomEvent("navigate-table", {
          detail: {
            connectionId: item.connectionId,
            schema: item.schema,
            table: item.name,
            objectKind: item.kind,
          },
        }),
      );
    }
    handleClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (e.key === "Enter" && filtered.length > 0) {
      handleSelect(filtered[activeIndex] ?? filtered[0]!);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="w-full max-w-lg rounded-lg border border-border bg-background p-0 top-[20vh] translate-y-0"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("quickOpen.title")}</DialogTitle>
          <DialogDescription>{t("quickOpen.description")}</DialogDescription>
        </DialogHeader>
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search size={16} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={filtered.length > 0}
            aria-activedescendant={
              filtered.length > 0
                ? `quick-open-option-${activeIndex}`
                : undefined
            }
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            placeholder={t("quickOpen.placeholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={handleClose}
          >
            <X />
          </Button>
        </div>

        {/* Results list */}
        <div className="max-h-80 overflow-y-auto" role="listbox">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {items.length === 0
                ? t("quickOpen.noConnections")
                : t("quickOpen.noResults")}
            </div>
          ) : (
            filtered.map((item, index) => {
              const Icon = KIND_ICON[item.kind];
              const kindLabel = KIND_LABEL[item.kind];
              return (
                <Button
                  key={`${item.connectionId}-${item.kind}-${item.schema}-${item.name}`}
                  id={`quick-open-option-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  variant="ghost"
                  size="sm"
                  className={`w-full justify-start gap-2 px-3 py-1.5 text-sm rounded-none h-auto ${
                    index === activeIndex ? "bg-muted" : ""
                  }`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <Icon
                    size={13}
                    className="shrink-0 text-muted-foreground"
                    aria-label={kindLabel}
                  />
                  <span className="text-foreground">{item.name}</span>
                  {item.kind !== "schema" && (
                    <span className="text-muted-foreground">
                      · {item.schema}
                    </span>
                  )}
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {item.connectionName}
                  </span>
                </Button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
