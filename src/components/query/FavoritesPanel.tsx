import { useState } from "react";
import { Star, Trash2, Globe, Link, X } from "lucide-react";
import { cn } from "@lib/utils";
import { useFavoritesStore, type FavoriteScope } from "@stores/favoritesStore";
import { Button } from "@components/ui/button";

interface FavoritesPanelProps {
  /** Active connection ID — used for "This Connection" filter and saving */
  connectionId: string;
  /** Callback to load SQL into the active query editor */
  onLoadSql: (sql: string) => void;
  /** Callback to close the panel */
  onClose: () => void;
}

export default function FavoritesPanel({
  connectionId,
  onLoadSql,
  onClose,
}: FavoritesPanelProps) {
  const favorites = useFavoritesStore((s) => s.favorites);
  const removeFavorite = useFavoritesStore((s) => s.removeFavorite);
  const [scope, setScope] = useState<FavoriteScope>("all");

  const filtered = favorites.filter((f) => {
    if (scope === "global") return f.connectionId === null;
    if (scope === "connection") return f.connectionId === connectionId;
    // "all" — show connection-scoped + global
    return f.connectionId === connectionId || f.connectionId === null;
  });

  const scopeTabs: { value: FavoriteScope; label: string }[] = [
    { value: "all", label: "All" },
    { value: "global", label: "Global" },
    { value: "connection", label: "This Connection" },
  ];

  return (
    <div className="flex flex-col border border-border bg-background shadow-lg rounded-md w-80 max-h-96">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary rounded-t-md">
        <div className="flex items-center gap-1.5 text-sm font-medium text-secondary-foreground">
          <Star size={14} className="text-primary" />
          <span>Favorites</span>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label="Close favorites"
        >
          <X />
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-border">
        {scopeTabs.map((tab) => (
          <button
            key={tab.value}
            className={cn(
              "flex-1 px-2 py-1.5 text-xs font-medium transition-colors",
              scope === tab.value
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setScope(tab.value)}
            aria-label={`Filter: ${tab.label}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No favorites yet
          </div>
        ) : (
          filtered.map((fav) => (
            <Button
              key={fav.id}
              variant="ghost"
              size="xs"
              className="w-full justify-start items-start gap-2 border-b border-border px-3 py-2 text-left h-auto rounded-none"
              onClick={() => {
                onLoadSql(fav.sql);
                onClose();
              }}
              aria-label={`Load favorite: ${fav.name}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-foreground truncate">
                    {fav.name}
                  </span>
                  {fav.connectionId === null ? (
                    <Globe
                      size={10}
                      className="shrink-0 text-muted-foreground"
                    />
                  ) : (
                    <Link
                      size={10}
                      className="shrink-0 text-muted-foreground"
                    />
                  )}
                </div>
                <div className="mt-0.5 text-[10px] font-mono text-muted-foreground truncate">
                  {fav.sql}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFavorite(fav.id);
                }}
                aria-label={`Delete favorite: ${fav.name}`}
              >
                <Trash2 />
              </Button>
            </Button>
          ))
        )}
      </div>
    </div>
  );
}
