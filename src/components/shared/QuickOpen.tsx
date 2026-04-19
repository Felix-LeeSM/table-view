import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Table2, Eye, Code2, Terminal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@components/ui/dialog";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";

type QuickOpenItemKind = "table" | "view" | "function" | "procedure";

interface QuickOpenItem {
  kind: QuickOpenItemKind;
  name: string;
  schema: string;
  connectionId: string;
  connectionName: string;
  /** Optional source code for functions/procedures. */
  source?: string | null;
}

const KIND_META: Record<
  QuickOpenItemKind,
  { label: string; Icon: typeof Table2 }
> = {
  table: { label: "Table", Icon: Table2 },
  view: { label: "View", Icon: Eye },
  function: { label: "Function", Icon: Code2 },
  procedure: { label: "Procedure", Icon: Terminal },
};

export default function QuickOpen() {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const tables = useSchemaStore((s) => s.tables);
  const views = useSchemaStore((s) => s.views);
  const functions = useSchemaStore((s) => s.functions);
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);

  // Build the searchable inventory from every connected schema's cached objects.
  const items = useMemo<QuickOpenItem[]>(() => {
    const result: QuickOpenItem[] = [];
    const connectedConns = connections.filter(
      (c) => activeStatuses[c.id]?.type === "connected",
    );

    for (const conn of connectedConns) {
      // Tables
      for (const key of Object.keys(tables)) {
        if (!key.startsWith(`${conn.id}:`)) continue;
        const list = tables[key] ?? [];
        for (const t of list) {
          result.push({
            kind: "table",
            name: t.name,
            schema: t.schema,
            connectionId: conn.id,
            connectionName: conn.name,
          });
        }
      }
      // Views
      for (const key of Object.keys(views)) {
        if (!key.startsWith(`${conn.id}:`)) continue;
        const list = views[key] ?? [];
        for (const v of list) {
          result.push({
            kind: "view",
            name: v.name,
            schema: v.schema,
            connectionId: conn.id,
            connectionName: conn.name,
          });
        }
      }
      // Functions / Procedures
      for (const key of Object.keys(functions)) {
        if (!key.startsWith(`${conn.id}:`)) continue;
        const list = functions[key] ?? [];
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
          });
        }
      }
    }
    return result;
  }, [tables, views, functions, connections, activeStatuses]);

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

  // Fuzzy-ish filter: match against "connection.schema.name" and individual parts.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const haystack =
        `${item.connectionName} ${item.schema} ${item.name}`.toLowerCase();
      // every whitespace-separated token must appear
      return q.split(/\s+/).every((tok) => haystack.includes(tok));
    });
  }, [items, search]);

  const handleClose = () => {
    setIsOpen(false);
    setSearch("");
  };

  const handleSelect = (item: QuickOpenItem) => {
    if (item.kind === "function" || item.kind === "procedure") {
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
          <DialogTitle>Quick Open</DialogTitle>
          <DialogDescription>
            Search tables, views, and functions across connected databases
          </DialogDescription>
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
            placeholder="Search tables, views, functions..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <button
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={handleClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Results list */}
        <div className="max-h-80 overflow-y-auto" role="listbox">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {items.length === 0
                ? "No connected databases — open a connection first"
                : "No results"}
            </div>
          ) : (
            filtered.map((item, index) => {
              const meta = KIND_META[item.kind];
              return (
                <button
                  key={`${item.connectionId}-${item.kind}-${item.schema}-${item.name}`}
                  id={`quick-open-option-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    index === activeIndex ? "bg-muted" : "hover:bg-muted"
                  }`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <meta.Icon
                    size={13}
                    className="shrink-0 text-muted-foreground"
                    aria-label={meta.label}
                  />
                  <span className="text-foreground">{item.name}</span>
                  <span className="text-muted-foreground">· {item.schema}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {item.connectionName}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
