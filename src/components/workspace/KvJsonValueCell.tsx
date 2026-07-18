import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import PreviewDialog from "@components/ui/dialog/PreviewDialog";
import { DocumentTreePanel } from "@components/document/DocumentTreePanel";
import { jsonTreeValue } from "./kvValueFormat";

export interface KvJsonValueCellProps {
  /** Raw value string as stored in Redis. */
  value: string;
  /** Row/field identity used as the tree header + dialog title. */
  label: string;
}

// KV JSON tree Phase 2 (2026-07-18) — a collection/stream value cell renders a
// read-only `{…}` / `[ n ]` chip (Mongo nested-chip parity) when the raw value
// parses to a JSON object or array; the chip opens a read-only
// DocumentTreePanel in a dialog. Scalar / non-JSON / empty / binary (hex)
// values fall through to the raw string exactly as before, so plain cells are
// byte-identical and never crash.
//
// Read-only: DocumentTreePanel gets no `onCommitEdit`, so its leaf editor is
// gated off (useTreeEditing returns early). The write path stays in
// KvMutationPanel, untouched. DoS caps (MAX_TREE_DEPTH / MAX_TREE_NODES) apply
// automatically via DocumentTreePanel's jsonTree walk.
export function KvJsonValueCell({ value, label }: KvJsonValueCellProps) {
  const { t } = useTranslation("workspace");
  const [open, setOpen] = useState(false);
  // Values can be large and a collection page holds many rows; memoize the
  // parse so re-renders don't re-run JSON.parse per cell.
  const parsed = useMemo(() => jsonTreeValue(value), [value]);

  if (parsed === null) return <>{value}</>;

  const isArr = Array.isArray(parsed);

  return (
    <>
      <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
        <span>{isArr ? "[" : "{"}</span>
        <button
          type="button"
          aria-label={t("kvKeyDetail.expandValueAria", { key: label })}
          onClick={() => setOpen(true)}
          className="inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {isArr ? (parsed as unknown[]).length : "…"}
        </button>
        <span>{isArr ? "]" : "}"}</span>
      </span>
      {open && (
        <PreviewDialog
          title={<span className="font-mono text-primary">{label}</span>}
          className="sm:max-w-3xl"
          onCancel={() => setOpen(false)}
          preview={<DocumentTreePanel value={parsed} fieldName={label} />}
        />
      )}
    </>
  );
}
