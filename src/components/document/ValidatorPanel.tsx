// Sprint 333 (2026-05-15) — Slice K live wire. Mongo paradigm 의 collection
// validator (`$jsonSchema` 외 모든 expression) 을 `collMod` IPC 로 read /
// apply / clear 한다. v0 는 raw JSON textarea + Save / Clear 버튼 —
// GUI builder 는 후속 sprint scope.

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeStringifyCell } from "@/lib/jsonCell";
import { getMongoValidator, setMongoValidator } from "@/lib/tauri";

export interface ValidatorPanelProps {
  connectionId: string;
  database: string;
  collection: string;
}

export function ValidatorPanel({
  connectionId,
  database,
  collection,
}: ValidatorPanelProps) {
  const [validatorText, setValidatorText] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (database === "" || collection === "") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMongoValidator(connectionId, database, collection)
      .then((v) => {
        if (cancelled) return;
        const text = v === null ? "" : safeStringifyCell(v, 2);
        setValidatorText(text);
        setOriginalText(text);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, database, collection]);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    let parsed: Record<string, unknown> | null;
    const trimmed = validatorText.trim();
    if (trimmed === "") {
      parsed = null;
    } else {
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch (e) {
        setSaveError(
          e instanceof Error ? `Invalid JSON: ${e.message}` : "Invalid JSON",
        );
        return;
      }
    }
    setSaving(true);
    try {
      await setMongoValidator(connectionId, database, collection, parsed);
      setOriginalText(validatorText);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [connectionId, database, collection, validatorText]);

  const handleClear = useCallback(async () => {
    setSaveError(null);
    setSaving(true);
    try {
      await setMongoValidator(connectionId, database, collection, null);
      setValidatorText("");
      setOriginalText("");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [connectionId, database, collection]);

  const dirty = validatorText !== originalText;

  return (
    <section
      aria-label="Validator panel"
      className="flex flex-col gap-2 p-3"
      data-testid="validator-panel"
    >
      <header className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>
          Validator — {database}.{collection}
        </span>
        {loading && (
          <span className="flex items-center gap-1 text-3xs">
            <Loader2 className="animate-spin" size={10} aria-hidden />
            Loading…
          </span>
        )}
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="validator-panel-error"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      <textarea
        aria-label="Validator JSON"
        data-testid="validator-panel-editor"
        spellCheck={false}
        value={validatorText}
        onChange={(e) => setValidatorText(e.target.value)}
        placeholder='{ "$jsonSchema": { "bsonType": "object", "required": ["name"] } }'
        className="h-48 w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
      />

      {saveError !== null && (
        <div
          role="alert"
          data-testid="validator-panel-save-error"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {saveError}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          data-testid="validator-panel-clear"
          disabled={saving || (originalText === "" && validatorText === "")}
          onClick={handleClear}
        >
          Clear validator
        </Button>
        <Button
          size="sm"
          data-testid="validator-panel-save"
          disabled={saving || !dirty}
          onClick={handleSave}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </section>
  );
}
