import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createMongoIndex } from "@/lib/tauri";
import { toast } from "@/lib/runtime/toast";
import type {
  CreateMongoIndexRequest,
  MongoIndexDirection,
} from "@/lib/tauri/document";

export interface CreateMongoIndexDialogProps {
  connectionId: string;
  database: string;
  collection: string;
  open: boolean;
  onClose: () => void;
  /**
   * Called once after a successful create so the parent panel can
   * re-fetch its index list. Awaited inside `handleSave` before the
   * dialog closes so the toast and refresh land together.
   */
  onCreated: (indexName: string) => void | Promise<void>;
}

interface FieldRow {
  name: string;
  direction: MongoIndexDirection;
}

/**
 * Mongo index create modal — full option set.
 *
 * Visible state contract (drives the test suite + AC-351-04):
 * - Index name input is optional; placeholder hints "auto" when empty.
 * - 1+ field rows; Save is disabled when every row is blank.
 * - asc/desc per row; compound (>= 2 rows) disables `expireAfterSeconds`
 *   with a visible hint (mirrors the backend gate).
 * - `partialFilterExpression` is a raw JSON textarea — invalid JSON
 *   paints an inline alert and disables Save until it parses.
 * - Collation locale + strength (1..5); when locale is blank the whole
 *   collation block is omitted from the IPC payload.
 * - On Save: invoke `createMongoIndex`; success → toast + onCreated +
 *   close; driver error → inline `role="alert"`, modal stays open,
 *   inputs preserved.
 */
export function CreateMongoIndexDialog({
  connectionId,
  database,
  collection,
  open,
  onClose,
  onCreated,
}: CreateMongoIndexDialogProps) {
  const [name, setName] = useState("");
  const [fields, setFields] = useState<FieldRow[]>([
    { name: "", direction: "asc" },
  ]);
  const [unique, setUnique] = useState(false);
  const [sparse, setSparse] = useState(false);
  const [ttlEnabled, setTtlEnabled] = useState(false);
  const [ttl, setTtl] = useState<string>("");
  const [partialFilter, setPartialFilter] = useState("");
  const [collationLocale, setCollationLocale] = useState("");
  const [collationStrength, setCollationStrength] = useState<number>(3);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form state on (re)open. Closes the door on stale inputs from a
  // previous cancelled session — matches the DropTriggerDialog pattern.
  useEffect(() => {
    if (open) {
      setName("");
      setFields([{ name: "", direction: "asc" }]);
      setUnique(false);
      setSparse(false);
      setTtlEnabled(false);
      setTtl("");
      setPartialFilter("");
      setCollationLocale("");
      setCollationStrength(3);
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  const isCompound = fields.length >= 2;

  // Parse the partialFilterExpression JSON on every keystroke. An empty
  // textarea is "no filter" and parses to `null`. Anything else must
  // parse to a non-null JSON object.
  const partialFilterParse = useMemo(():
    | { ok: true; value: Record<string, unknown> | null }
    | { ok: false; error: string } => {
    const trimmed = partialFilter.trim();
    if (trimmed === "") return { ok: true, value: null };
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return {
          ok: false,
          error: "partialFilterExpression must be a JSON object",
        };
      }
      return { ok: true, value: parsed as Record<string, unknown> };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [partialFilter]);

  const hasAtLeastOneField = fields.some((f) => f.name.trim().length > 0);
  const canSave = hasAtLeastOneField && partialFilterParse.ok && !submitting;

  const addField = () => {
    setFields((rows) => [...rows, { name: "", direction: "asc" }]);
  };

  const removeField = (index: number) => {
    setFields((rows) => {
      if (rows.length <= 1) return rows;
      return rows.filter((_, i) => i !== index);
    });
  };

  const updateField = (index: number, patch: Partial<FieldRow>) => {
    setFields((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const handleSave = async () => {
    if (!canSave) return;
    setError(null);
    setSubmitting(true);

    const trimmedFields = fields
      .map((f) => ({ name: f.name.trim(), direction: f.direction }))
      .filter((f) => f.name.length > 0);

    const request: CreateMongoIndexRequest = {
      fields: trimmedFields,
    };
    const trimmedName = name.trim();
    if (trimmedName.length > 0) request.name = trimmedName;
    if (unique) request.unique = true;
    if (sparse) request.sparse = true;
    if (ttlEnabled && !isCompound && ttl.trim().length > 0) {
      const secs = Number(ttl);
      if (!Number.isFinite(secs) || secs < 0 || !Number.isInteger(secs)) {
        setError("expireAfterSeconds must be a non-negative integer");
        setSubmitting(false);
        return;
      }
      request.expireAfterSeconds = secs;
    }
    if (partialFilterParse.ok && partialFilterParse.value !== null) {
      request.partialFilterExpression = partialFilterParse.value;
    }
    const locale = collationLocale.trim();
    if (locale.length > 0) {
      request.collation = { locale, strength: collationStrength };
    }

    try {
      const result = await createMongoIndex(
        connectionId,
        database,
        collection,
        request,
      );
      toast.success(`Index "${result.name}" created`);
      await onCreated(result.name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) onClose();
      }}
    >
      <DialogContent
        data-testid="mongo-create-index-dialog"
        className="w-dialog-md"
      >
        <DialogHeader layout="column">
          <DialogTitle>Create Index</DialogTitle>
          <DialogDescription>
            {database}.{collection}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="mongo-create-index-name"
              className="mb-1 block text-xs font-medium"
            >
              Name <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              id="mongo-create-index-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="auto"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium">Fields</span>
              <button
                type="button"
                onClick={addField}
                data-testid="mongo-create-index-add-field"
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="size-3" /> Add field
              </button>
            </div>
            <div className="space-y-2">
              {fields.map((field, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={field.name}
                    onChange={(e) => updateField(i, { name: e.target.value })}
                    placeholder="field name"
                    aria-label={`Field ${i + 1} name`}
                    data-testid={`mongo-create-index-field-name-${i}`}
                    className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                  />
                  <select
                    value={field.direction}
                    onChange={(e) =>
                      updateField(i, {
                        direction: e.target.value as MongoIndexDirection,
                      })
                    }
                    aria-label={`Field ${i + 1} direction`}
                    data-testid={`mongo-create-index-field-dir-${i}`}
                    className="rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                  >
                    <option value="asc">asc</option>
                    <option value="desc">desc</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    disabled={fields.length <= 1}
                    aria-label={`Remove field ${i + 1}`}
                    data-testid={`mongo-create-index-field-remove-${i}`}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={unique}
                onChange={(e) => setUnique(e.target.checked)}
                data-testid="mongo-create-index-unique"
              />
              unique
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={sparse}
                onChange={(e) => setSparse(e.target.checked)}
                data-testid="mongo-create-index-sparse"
              />
              sparse
            </label>
          </div>

          <div>
            <label
              htmlFor="mongo-create-index-ttl"
              className={`mb-1 block text-xs font-medium ${
                isCompound ? "text-muted-foreground/60" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={ttlEnabled}
                onChange={(e) => setTtlEnabled(e.target.checked)}
                disabled={isCompound}
                data-testid="mongo-create-index-ttl-toggle"
                className="mr-1.5"
              />
              expireAfterSeconds (TTL)
            </label>
            <input
              id="mongo-create-index-ttl"
              type="number"
              min={0}
              value={ttl}
              onChange={(e) => setTtl(e.target.value)}
              disabled={isCompound || !ttlEnabled}
              data-testid="mongo-create-index-ttl"
              placeholder="seconds"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:bg-muted/30 disabled:text-muted-foreground"
            />
            {isCompound && (
              <p
                className="mt-1 text-3xs text-muted-foreground"
                data-testid="mongo-create-index-ttl-hint"
              >
                TTL requires a single-field index.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="mongo-create-index-partial"
              className="mb-1 block text-xs font-medium"
            >
              partialFilterExpression{" "}
              <span className="text-muted-foreground">
                (raw JSON, optional)
              </span>
            </label>
            <textarea
              id="mongo-create-index-partial"
              value={partialFilter}
              onChange={(e) => setPartialFilter(e.target.value)}
              data-testid="mongo-create-index-partial"
              placeholder={'{ "active": true }'}
              rows={3}
              className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary"
            />
            {!partialFilterParse.ok && partialFilter.trim().length > 0 && (
              <p
                role="alert"
                data-testid="mongo-create-index-partial-error"
                className="mt-1 text-3xs text-destructive"
              >
                {partialFilterParse.error}
              </p>
            )}
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium">
              Collation{" "}
              <span className="text-muted-foreground">(optional)</span>
            </span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={collationLocale}
                onChange={(e) => setCollationLocale(e.target.value)}
                placeholder="locale (e.g. en)"
                aria-label="Collation locale"
                data-testid="mongo-create-index-collation-locale"
                className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
              />
              <select
                value={collationStrength}
                onChange={(e) => setCollationStrength(Number(e.target.value))}
                aria-label="Collation strength"
                data-testid="mongo-create-index-collation-strength"
                className="rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
              >
                {[1, 2, 3, 4, 5].map((s) => (
                  <option key={s} value={s}>
                    strength {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error !== null && (
            <div
              role="alert"
              data-testid="mongo-create-index-error"
              className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!canSave}
            data-testid="mongo-create-index-save"
          >
            {submitting && (
              <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
