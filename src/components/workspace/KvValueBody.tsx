import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2 } from "lucide-react";
import { CellDetailDialog } from "@components/datagrid";
import { DocumentTreePanel } from "@components/document/DocumentTreePanel";
import type { KvValueEnvelope } from "@/types/kv";
import {
  isJsonTreeCapable,
  jsonTreeValue,
  renderValueText,
} from "./kvValueFormat";

export interface KvValueBodyProps {
  envelope: KvValueEnvelope;
}

// KV JSON tree Phase 1 (2026-07-17) — read-only smart renderer for single-value
// keys (string / json). Collections (hash/list/set/zSet) and streams are routed
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
// Read-only: DocumentTreePanel gets no `onCommitEdit`, so its leaf editor is
// gated off. The write path lives in KvMutationPanel below, unchanged.
export function KvValueBody({ envelope }: KvValueBodyProps) {
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
