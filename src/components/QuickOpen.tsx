import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

interface QuickOpenTable {
  name: string;
  schema: string;
  connectionId: string;
}

export default function QuickOpen() {
  const [isOpen, setIsOpen] = useState(false);
  const [tables, setTables] = useState<QuickOpenTable[]>([]);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tables?: QuickOpenTable[] }>).detail;
      setTables(detail?.tables ?? []);
      setSearch("");
      setActiveIndex(0);
      setIsOpen(true);
      // Auto-focus after render
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    };
    window.addEventListener("quick-open", handler);
    return () => window.removeEventListener("quick-open", handler);
  }, []);

  const filtered = tables.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()),
  );

  const handleClose = () => {
    setIsOpen(false);
    setSearch("");
  };

  const handleSelect = (table: QuickOpenTable) => {
    window.dispatchEvent(
      new CustomEvent("navigate-table", {
        detail: {
          connectionId: table.connectionId,
          schema: table.schema,
          table: table.name,
        },
      }),
    );
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
          <DialogTitle>Quick Open Table</DialogTitle>
          <DialogDescription>Search and navigate to a table</DialogDescription>
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
            placeholder="Search tables..."
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
        <div className="max-h-64 overflow-y-auto" role="listbox">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No tables found
            </div>
          ) : (
            filtered.map((table, index) => (
              <button
                key={`${table.connectionId}-${table.schema}-${table.name}`}
                id={`quick-open-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                  index === activeIndex ? "bg-muted" : "hover:bg-muted"
                }`}
                onClick={() => handleSelect(table)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="text-muted-foreground">{table.schema}.</span>
                <span className="text-foreground">{table.name}</span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
