// Sprint 334 (2026-05-15) — Slice L live wire. Mongo collection DDL
// (create / rename / drop). v0 의 create options 는 raw JSON textarea
// passthrough — capped / timeseries 전용 form 필드는 후속 sprint.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  createCollection,
  dropCollection,
  renameCollection,
} from "@/lib/tauri";

export type CollectionDdlMode = "create" | "rename" | "drop";

export interface CollectionDdlDialogProps {
  open: boolean;
  mode: CollectionDdlMode;
  connectionId: string;
  database: string;
  collection?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export function CollectionDdlDialog({
  open,
  mode,
  connectionId,
  database,
  collection,
  onClose,
  onSuccess,
}: CollectionDdlDialogProps) {
  const [name, setName] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setOptionsText("");
      setRenameTo("");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  const handleSave = useCallback(async () => {
    setError(null);
    setSaving(true);
    try {
      if (mode === "create") {
        if (name.trim() === "") {
          setError("Collection name is required.");
          setSaving(false);
          return;
        }
        let parsed: Record<string, unknown> | null = null;
        if (optionsText.trim() !== "") {
          try {
            parsed = JSON.parse(optionsText) as Record<string, unknown>;
          } catch (e) {
            setError(
              e instanceof Error
                ? `Invalid options JSON: ${e.message}`
                : "Invalid options JSON",
            );
            setSaving(false);
            return;
          }
        }
        await createCollection(connectionId, database, name.trim(), parsed);
      } else if (mode === "rename") {
        if (collection === undefined || collection === "") {
          setError("Source collection is required for rename.");
          setSaving(false);
          return;
        }
        if (renameTo.trim() === "") {
          setError("New name is required.");
          setSaving(false);
          return;
        }
        await renameCollection(
          connectionId,
          database,
          collection,
          renameTo.trim(),
        );
      } else {
        if (collection === undefined || collection === "") {
          setError("Collection is required for drop.");
          setSaving(false);
          return;
        }
        await dropCollection(connectionId, database, collection);
      }
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [
    mode,
    connectionId,
    database,
    collection,
    name,
    optionsText,
    renameTo,
    onClose,
    onSuccess,
  ]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label={`Collection DDL — ${mode}`}
      data-testid="collection-ddl-dialog"
      className="flex flex-col gap-3 rounded-md border border-border bg-background p-4 text-sm"
    >
      <header className="text-xs font-medium text-muted-foreground">
        Collection {mode} — {database}
        {collection ? `.${collection}` : ""}
      </header>

      {mode === "create" && (
        <>
          <label className="flex flex-col gap-1 text-xs">
            <span>Name</span>
            <input
              data-testid="collection-ddl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
              spellCheck={false}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span>Options (JSON, optional)</span>
            <textarea
              data-testid="collection-ddl-options"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              spellCheck={false}
              placeholder='{ "capped": true, "size": 1048576 }'
              className="h-32 w-full resize-y rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
            />
          </label>
        </>
      )}

      {mode === "rename" && (
        <label className="flex flex-col gap-1 text-xs">
          <span>Rename to</span>
          <input
            data-testid="collection-ddl-rename-to"
            value={renameTo}
            onChange={(e) => setRenameTo(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
            spellCheck={false}
          />
        </label>
      )}

      {mode === "drop" && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          This will permanently delete <strong>{collection}</strong> and every
          document it contains. This cannot be undone.
        </p>
      )}

      {error !== null && (
        <div
          role="alert"
          data-testid="collection-ddl-error"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Close collection DDL dialog"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          data-testid="collection-ddl-save"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Working…" : mode === "drop" ? "Drop" : "Save"}
        </Button>
      </div>
    </div>
  );
}
