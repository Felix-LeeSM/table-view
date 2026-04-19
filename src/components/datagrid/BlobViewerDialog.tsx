import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";

export interface BlobViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: unknown;
  columnName: string;
}

type ViewTab = "hex" | "text";

/** Convert unknown cell data to a Uint8Array for hex/text viewing. */
function toBytes(data: unknown): Uint8Array {
  if (data == null) return new Uint8Array(0);

  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }

  if (typeof data === "number" || typeof data === "boolean") {
    return new TextEncoder().encode(String(data));
  }

  // Objects (including arrays) — JSON stringify then encode
  if (typeof data === "object") {
    return new TextEncoder().encode(JSON.stringify(data));
  }

  return new TextEncoder().encode(String(data));
}

/** Format bytes as a classic hex dump with offset, hex, and ASCII columns. */
function formatHexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const slice = bytes.slice(offset, Math.min(offset + 16, bytes.length));

    // Offset
    const offsetStr = offset.toString(16).padStart(8, "0");

    // Hex bytes — 8 on left, 8 on right with double-space separator
    const hexParts: string[] = [];
    for (let i = 0; i < 16; i++) {
      if (i === 8) hexParts.push(" ");
      if (i < slice.length) {
        hexParts.push(slice[i]!.toString(16).padStart(2, "0"));
      } else {
        hexParts.push("  ");
      }
    }

    // ASCII column — printable chars, dots for non-printable
    let ascii = "";
    for (let i = 0; i < slice.length; i++) {
      const byte = slice[i]!;
      ascii += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".";
    }

    lines.push(
      `${offsetStr}  ${hexParts.join(" ")}  |${ascii.padEnd(16, " ")}|`,
    );
  }
  return lines.join("\n");
}

/** Try to decode bytes as UTF-8 text; return null if not decodable. */
function tryDecodeText(bytes: Uint8Array): string | null {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

export default function BlobViewerDialog({
  open,
  onOpenChange,
  data,
  columnName,
}: BlobViewerDialogProps) {
  const [activeTab, setActiveTab] = useState<ViewTab>("hex");

  const bytes = useMemo(() => toBytes(data), [data]);
  const hexDump = useMemo(() => formatHexDump(bytes), [bytes]);
  const textContent = useMemo(() => {
    if (bytes.length === 0) return "(empty)";
    const decoded = tryDecodeText(bytes);
    return (
      decoded ??
      `(binary data — cannot decode as UTF-8)\n\n${formatHexDump(bytes)}`
    );
  }, [bytes]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            BLOB Viewer — <span className="font-mono">{columnName}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Tab selector */}
        <div className="flex gap-1 border-b border-border">
          <button
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "hex"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("hex")}
          >
            Hex
          </button>
          <button
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "text"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("text")}
          >
            Text
          </button>
        </div>

        {/* Content area */}
        <div className="max-h-[80vh] overflow-auto rounded border border-border bg-muted/30">
          {activeTab === "hex" ? (
            <pre className="p-3 text-xs leading-5 text-foreground font-mono whitespace-pre">
              {bytes.length === 0 ? "(empty)" : hexDump}
            </pre>
          ) : (
            <pre className="p-3 text-xs leading-5 text-foreground font-mono whitespace-pre-wrap break-all">
              {textContent}
            </pre>
          )}
        </div>

        {/* Footer info */}
        <div className="text-xs text-muted-foreground">
          {bytes.length} byte{bytes.length !== 1 ? "s" : ""}
        </div>
      </DialogContent>
    </Dialog>
  );
}
