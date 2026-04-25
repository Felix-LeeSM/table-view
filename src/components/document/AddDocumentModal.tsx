import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import { Button } from "@components/ui/button";

/**
 * Sprint 87 — Add Document modal for the document paradigm.
 *
 * Lightweight JSON editor for inserting a single document. The textarea
 * accepts raw JSON; on submit the component parses the text, validates it as
 * a non-array object, and forwards the result to `onSubmit`. Wire-format
 * serialisation is deferred to the caller (which knows the connection +
 * namespace); this component only owns the JSON round-trip.
 *
 * - Valid input: a JSON object → `onSubmit(parsed)`.
 * - Invalid JSON, empty input, or non-object JSON: local `parseError` shown
 *   above the footer. `onSubmit` is NOT called.
 * - `error` prop lets the parent surface errors from the async insert call
 *   (e.g. a Mongo server rejection) without re-rendering the whole tree.
 * - Esc / Cancel closes via `onCancel`; Radix handles the Esc key.
 */
export interface AddDocumentModalProps {
  onSubmit: (record: Record<string, unknown>) => void | Promise<void>;
  onCancel: () => void;
  loading?: boolean;
  error?: string | null;
}

const DEFAULT_TEMPLATE = `{
  "name": ""
}`;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export default function AddDocumentModal({
  onSubmit,
  onCancel,
  loading = false,
  error = null,
}: AddDocumentModalProps) {
  const [text, setText] = useState<string>(DEFAULT_TEMPLATE);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      setParseError("Document is required");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      setParseError(
        err instanceof Error ? `Invalid JSON: ${err.message}` : "Invalid JSON",
      );
      return;
    }
    if (!isPlainObject(parsed)) {
      setParseError("Document must be a JSON object");
      return;
    }
    setParseError(null);
    void onSubmit(parsed);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="w-dialog-lg bg-background p-0"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Add Document</DialogTitle>
          <DialogDescription>Insert a new MongoDB document</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col rounded-lg border border-border bg-background shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              Add Document
            </h3>
            <button
              type="button"
              className="rounded p-1 hover:bg-muted"
              onClick={onCancel}
              aria-label="Close add document"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex flex-col gap-2 p-4">
            <label
              htmlFor="add-document-textarea"
              className="text-xs font-medium text-secondary-foreground"
            >
              Document (JSON)
            </label>
            <textarea
              id="add-document-textarea"
              aria-label="Document JSON"
              autoFocus
              rows={10}
              className="min-h-48 w-full rounded border border-border bg-secondary p-2 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              value={text}
              disabled={loading}
              onChange={(e) => {
                setText(e.target.value);
                if (parseError) setParseError(null);
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <p className="text-2xs text-muted-foreground">
              Omit the <code className="font-mono">_id</code> field to let
              MongoDB generate one. Press{" "}
              <kbd className="rounded bg-secondary px-1 py-0.5">Cmd+Enter</kbd>{" "}
              to submit.
            </p>
            {parseError && (
              <p role="alert" className="text-xs text-destructive">
                {parseError}
              </p>
            )}
            {error && !parseError && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter className="border-t border-border px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={loading}
              aria-label="Submit add document"
            >
              {loading ? <Loader2 className="animate-spin" /> : <Plus />}
              {loading ? "Inserting..." : "Add"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
