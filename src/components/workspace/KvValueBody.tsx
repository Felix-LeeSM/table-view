import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2 } from "lucide-react";
import { CellDetailDialog } from "@components/datagrid";
import { DocumentTreePanel } from "@components/document/DocumentTreePanel";
import type { KvValueEnvelope } from "@/types/kv";
import { KvJsonTreeEditor } from "./KvJsonTreeEditor";
import {
  isJsonTreeCapable,
  jsonTreeValue,
  renderValueText,
} from "./kvValueFormat";

export interface KvValueBodyProps {
  envelope: KvValueEnvelope;
  // KV JSON tree write core (PR3) — when all four are supplied AND the
  // connection allows edits, a JSON `string` / `json` value renders as an
  // EDITABLE tree. Omit any of them (or pass `mutationEnabled={false}`) and the
  // tree stays read-only — the safe default so a write path is never offered
  // without an explicit, wired-up target.
  connectionId?: string;
  database?: number;
  mutationEnabled?: boolean;
  onWriteSuccess?: (key: string) => Promise<void> | void;
}

// KV JSON tree Phase 1 (2026-07-17) — smart renderer for single-value keys
// (string / json). Collections (hash/list/set/zSet) and streams are routed
// elsewhere by KvKeyDetailPanel; this component owns the `<pre>` fallthrough,
// which previously leaked native ReJSON (`json`) values as raw text.
//
// - `json`: value is already parsed. Objects/arrays render as a JSON tree;
//   scalars fall through to raw text.
// - `string` + utf8: try JSON.parse. An object/array result renders as a tree;
//   scalars / parse failures stay raw text.
// - `string` + binary (hex): never attempt JSON — show the hex text.
// - missing / unsupported: raw text.
//
// PR3 (2026-07-18) — an object/array value additionally becomes node-editable
// via KvJsonTreeEditor when the write context is supplied; parse failures /
// scalars / binary stay read-only raw text (never given a commit handler).
export function KvValueBody({
  envelope,
  connectionId,
  database,
  mutationEnabled = false,
  onWriteSuccess,
}: KvValueBodyProps) {
  const { t } = useTranslation("workspace");
  const [detailOpen, setDetailOpen] = useState(false);
  const { value } = envelope;

  const treeValue =
    value.type === "json" && isJsonTreeCapable(value.value)
      ? value.value
      : value.type === "string" && value.encoding === "utf8"
        ? jsonTreeValue(value.text ?? "")
        : null;

  if (treeValue !== null) {
    const editable =
      mutationEnabled &&
      connectionId !== undefined &&
      database !== undefined &&
      onWriteSuccess !== undefined &&
      (value.type === "json" || value.type === "string");
    if (editable) {
      return (
        <KvJsonTreeEditor
          key={envelope.key}
          target={{
            kind: value.type === "json" ? "json" : "string",
            key: envelope.key,
          }}
          treeLabel={envelope.key}
          original={treeValue}
          connectionId={connectionId}
          database={database}
          onWriteSuccess={onWriteSuccess}
        />
      );
    }
    return <DocumentTreePanel value={treeValue} fieldName={envelope.key} />;
  }

  const text = renderValueText(envelope);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setDetailOpen(true)}
        aria-label={t("kvKeyDetail.expandValueAria", { key: envelope.key })}
        className="absolute right-1 top-1 z-10 inline-flex items-center rounded border border-border bg-background/80 p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <Maximize2 size={12} aria-hidden />
      </button>
      <pre className="max-h-96 overflow-auto rounded border border-border bg-muted/40 p-2 pr-8 text-3xs text-foreground">
        {text}
      </pre>
      <CellDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        data={text}
        columnName={envelope.key}
      />
    </div>
  );
}
