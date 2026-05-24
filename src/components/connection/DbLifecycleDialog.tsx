// Sprint 335 (2026-05-15) — Slice M live wire. Database lifecycle
// (CREATE / DROP DATABASE) for RDB (PG) + Mongo. Mongo create는 lazy
// (collection 첫 write 시 자동 생성) — informational copy 로만 처리.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createRdbDatabase, dropRdbDatabase } from "@/lib/tauri/ddl";
import { dropMongoDatabase } from "@/lib/tauri";

export type DbLifecycleMode = "create" | "drop";

export interface DbLifecycleDialogProps {
  open: boolean;
  mode: DbLifecycleMode;
  connectionId: string;
  database?: string;
  paradigm: "table" | "document";
  onClose: () => void;
  onSuccess?: () => void;
}

export function DbLifecycleDialog({
  open,
  mode,
  connectionId,
  database,
  paradigm,
  onClose,
  onSuccess,
}: DbLifecycleDialogProps) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setError(null);
      setSaving(false);
    } else if (mode === "drop" && database !== undefined) {
      setName(database);
    }
  }, [open, mode, database]);

  const isMongoLazyCreate = paradigm === "document" && mode === "create";

  const handleSave = useCallback(async () => {
    if (isMongoLazyCreate) {
      onClose();
      return;
    }
    setError(null);
    const target = mode === "drop" ? (database ?? name) : name;
    if (target.trim() === "") {
      setError("Database name is required.");
      return;
    }
    setSaving(true);
    try {
      if (paradigm === "table") {
        if (mode === "create") {
          await createRdbDatabase(connectionId, target.trim());
        } else {
          await dropRdbDatabase(connectionId, target.trim());
        }
      } else {
        await dropMongoDatabase(connectionId, target.trim(), true);
      }
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [
    isMongoLazyCreate,
    paradigm,
    mode,
    connectionId,
    database,
    name,
    onClose,
    onSuccess,
  ]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label={`Database ${mode}`}
      data-testid="db-lifecycle-dialog"
      data-paradigm={paradigm}
      className="flex flex-col gap-3 rounded-md border border-border bg-background p-4 text-sm"
    >
      <header className="text-xs font-medium text-muted-foreground">
        Database {mode}
        {database !== undefined ? ` — ${database}` : ""}
      </header>

      {isMongoLazyCreate ? (
        <p
          data-testid="db-lifecycle-mongo-lazy"
          className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        >
          MongoDB creates databases <strong>on first write</strong>. Insert a
          document into a collection inside your target database and it will
          appear in the sidebar.
        </p>
      ) : mode === "create" ? (
        <label className="flex flex-col gap-1 text-xs">
          <span>Name</span>
          <input
            data-testid="db-lifecycle-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
            className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
          />
        </label>
      ) : (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          This will permanently delete <strong>{database ?? name}</strong> and
          every {paradigm === "table" ? "table and row" : "collection"} it
          contains. This cannot be undone.
        </p>
      )}

      {error !== null && (
        <div
          role="alert"
          data-testid="db-lifecycle-error"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Close database lifecycle dialog"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          data-testid="db-lifecycle-save"
          onClick={handleSave}
          disabled={saving}
        >
          {saving
            ? "Working…"
            : isMongoLazyCreate
              ? "OK"
              : mode === "drop"
                ? "Drop"
                : "Create"}
        </Button>
      </div>
    </div>
  );
}
