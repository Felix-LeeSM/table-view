import { useState } from "react";
import { Check, Copy, Download, Upload } from "lucide-react";
import { useConnectionStore } from "@stores/connectionStore";
import { Button } from "@components/ui/button";
import TabsDialog from "@components/ui/dialog/TabsDialog";
import {
  exportConnections,
  importConnections,
  type ImportResult,
} from "@lib/tauri";

interface ImportExportDialogProps {
  onClose: () => void;
  /** Optional initial tab. Defaults to "export". */
  initialTab?: "export" | "import";
}

/**
 * Sprint 96: migrated to the `TabsDialog` preset. The Export/Import panes
 * keep their bodies; the preset owns the title + tab list + dialog shell.
 */
export default function ImportExportDialog({
  onClose,
  initialTab = "export",
}: ImportExportDialogProps) {
  const [tab, setTab] = useState<"export" | "import">(initialTab);

  return (
    <TabsDialog
      title="Import / Export Connections"
      description="Move connections between machines as JSON. Passwords are never included."
      className="w-dialog-lg bg-secondary"
      onClose={onClose}
      value={tab}
      onTabChange={(v) => setTab(v as "export" | "import")}
      tabs={[
        {
          value: "export",
          label: "Export",
          triggerNode: (
            <span className="inline-flex items-center gap-1.5">
              <Download size={12} /> Export
            </span>
          ),
          content: <ExportPanel />,
        },
        {
          value: "import",
          label: "Import",
          triggerNode: (
            <span className="inline-flex items-center gap-1.5">
              <Upload size={12} /> Import
            </span>
          ),
          content: <ImportPanel onImported={onClose} />,
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function ExportPanel() {
  const connections = useConnectionStore((s) => s.connections);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(connections.map((c) => c.id)),
  );
  const [json, setJson] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const allChecked = selected.size === connections.length;

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleGenerate = async () => {
    setError(null);
    try {
      const out = await exportConnections(Array.from(selected));
      setJson(out);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleCopy = () => {
    navigator.clipboard
      .writeText(json)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard may be unavailable in some contexts
      });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Select connections to include. Passwords are <strong>never</strong>{" "}
        exported — re-enter them after importing.
      </p>

      {connections.length === 0 ? (
        <div
          role="status"
          className="rounded border border-border bg-background px-3 py-4 text-center text-xs text-muted-foreground"
        >
          No connections to export.
        </div>
      ) : (
        <div className="max-h-40 overflow-auto rounded border border-border bg-background">
          <label className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-muted">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? new Set(connections.map((c) => c.id))
                    : new Set(),
                )
              }
            />
            Select all ({connections.length})
          </label>
          {connections.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-secondary-foreground hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
              />
              <span className="font-medium text-foreground">{c.name}</span>
              <span className="text-muted-foreground">
                ({c.db_type} @ {c.host}:{c.port})
              </span>
              {c.has_password && (
                <span className="ml-auto rounded bg-success/10 px-1.5 text-3xs font-medium text-success">
                  pw set
                </span>
              )}
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={handleGenerate}
          disabled={selected.size === 0}
        >
          Generate JSON
        </Button>
        {json.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            aria-label="Copy export JSON to clipboard"
          >
            {copied ? (
              <>
                <Check size={12} className="text-success" /> Copied
              </>
            ) : (
              <>
                <Copy size={12} /> Copy to clipboard
              </>
            )}
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {json.length > 0 && (
        <textarea
          className="h-48 w-full resize-none rounded border border-border bg-background p-2 font-mono text-2xs text-foreground outline-none focus:border-primary"
          value={json}
          readOnly
          aria-label="Generated export JSON"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

interface ImportPanelProps {
  onImported: () => void;
}

function ImportPanel({ onImported }: ImportPanelProps) {
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const loadGroups = useConnectionStore((s) => s.loadGroups);
  const [text, setText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const handleImport = async () => {
    setError(null);
    setResult(null);
    setRunning(true);
    try {
      const r = await importConnections(text);
      setResult(r);
      // Refresh stores so the sidebar shows the new entries
      await loadConnections();
      await loadGroups();
    } catch (e) {
      setError(String(e));
    }
    setRunning(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Paste a previously-exported JSON below. All imported connections start{" "}
        <strong>without a password</strong>; you must edit each one before
        connecting.
      </p>

      <textarea
        className="h-40 w-full resize-none rounded border border-border bg-background p-2 font-mono text-2xs text-foreground outline-none focus:border-primary"
        placeholder='{"schema_version":1,"connections":[...],"groups":[...]}'
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Import JSON input"
      />

      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={handleImport}
          disabled={running || !text.trim()}
        >
          {running ? "Importing…" : "Import"}
        </Button>
        {result && (
          <Button variant="outline" size="sm" onClick={onImported}>
            Done
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {result && <ImportResultPanel result={result} />}
    </div>
  );
}

function ImportResultPanel({ result }: { result: ImportResult }) {
  const renamedCount = result.renamed.length;
  const skippedCount = result.skipped_groups.length;
  const createdGroupCount = result.created_groups.length;

  return (
    <div className="space-y-2 rounded border border-border bg-background px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <Check size={12} className="text-success" />
        <span className="font-medium text-foreground">
          Imported {result.imported.length} connection
          {result.imported.length === 1 ? "" : "s"}
        </span>
      </div>
      {createdGroupCount > 0 && (
        <p className="text-muted-foreground">
          Created {createdGroupCount} group
          {createdGroupCount === 1 ? "" : "s"}.
        </p>
      )}
      {renamedCount > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">
            {renamedCount} name conflict
            {renamedCount === 1 ? "" : "s"} auto-resolved
          </summary>
          <ul className="mt-1 list-disc pl-5 text-secondary-foreground">
            {result.renamed.map((r) => (
              <li key={r.new_name}>
                <span className="font-mono">{r.original_name}</span> →{" "}
                <span className="font-mono">{r.new_name}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {skippedCount > 0 && (
        <details>
          <summary className="cursor-pointer text-warning">
            {skippedCount} connection
            {skippedCount === 1 ? "" : "s"} placed at root (missing group)
          </summary>
          <ul className="mt-1 list-disc pl-5 text-secondary-foreground">
            {result.skipped_groups.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="border-t border-border pt-2 text-muted-foreground">
        Open each imported connection in the sidebar and re-enter its password
        before connecting.
      </p>
    </div>
  );
}
