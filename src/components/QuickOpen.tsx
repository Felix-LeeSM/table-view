import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

interface QuickOpenTable {
  name: string;
  schema: string;
  connectionId: string;
}

export default function QuickOpen() {
  const [isOpen, setIsOpen] = useState(false);
  const [tables, setTables] = useState<QuickOpenTable[]>([]);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tables?: QuickOpenTable[] }>).detail;
      setTables(detail?.tables ?? []);
      setSearch("");
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
    if (e.key === "Enter" && filtered.length > 0) {
      handleSelect(filtered[0]!);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg rounded-lg border border-(--color-border) bg-(--color-bg-primary) shadow-xl">
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-(--color-border) px-3 py-2">
          <Search size={16} className="shrink-0 text-(--color-text-muted)" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-sm text-(--color-text-primary) outline-none placeholder:text-(--color-text-muted)"
            placeholder="Search tables..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <button
            className="shrink-0 text-(--color-text-muted) hover:text-(--color-text-primary)"
            onClick={handleClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Results list */}
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-(--color-text-muted)">
              No tables found
            </div>
          ) : (
            filtered.map((table) => (
              <button
                key={`${table.connectionId}-${table.schema}-${table.name}`}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-(--color-bg-tertiary)"
                onClick={() => handleSelect(table)}
              >
                <span className="text-(--color-text-muted)">
                  {table.schema}.
                </span>
                <span className="text-(--color-text-primary)">
                  {table.name}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
