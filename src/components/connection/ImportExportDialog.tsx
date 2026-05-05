import { useEffect, useState } from "react";
import { Check, Copy, Download, Upload, AlertTriangle } from "lucide-react";
import { useConnectionStore } from "@stores/connectionStore";
import { Button } from "@components/ui/button";
import TabsDialog from "@components/ui/dialog/TabsDialog";
import {
  exportConnectionsEncrypted,
  importConnections,
  importConnectionsEncrypted,
  type ImportResult,
} from "@lib/tauri";
import MasterPasswordField from "./import-export/MasterPasswordField";
import SelectionTree from "./import-export/SelectionTree";

interface ImportExportDialogProps {
  onClose: () => void;
  /** Optional initial tab. Defaults to "export". */
  initialTab?: "export" | "import";
}
/**
 * Sprint 140 — canonical message rendered inline when the user enters the
 * wrong master password. The backend emits the same string from
 * `AppError::Encryption("Incorrect master password — the file could not be
 * decrypted")`. Tests assert that this exact string makes it to the UI
 * surface.
 */
const INCORRECT_MASTER_PASSWORD_MESSAGE =
  "Incorrect master password — the file could not be decrypted";

/**
 * Sprint 96: migrated to the `TabsDialog` preset. The Export/Import panes
 * keep their bodies; the preset owns the title + tab list + dialog shell.
 *
 * Sprint 140: the Export pane wraps the selection in a master-password
 * envelope (Argon2id + AES-256-GCM) instead of emitting plain JSON; the
 * Import pane auto-detects envelope vs plain payload and surfaces the
 * shared "Incorrect master password" message on a wrong-password failure.
 *
 * 2026-05-05: Export pane는 사용자가 password를 직접 입력하지 않는다.
 * backend가 BIP39 12-word mnemonic을 자동 생성해 envelope과 함께 돌려주고,
 * 사용자는 받은 mnemonic을 비밀번호 매니저에 보관한 뒤 체크박스로 책임을
 * 명시 인정해야 다음 단계 진행. dialog 닫히면 mnemonic은 React state에서
 * 사라진다 (브라우저 메모리 위생은 best-effort).
 */
export default function ImportExportDialog({
  onClose,
  initialTab = "export",
}: ImportExportDialogProps) {
  const [tab, setTab] = useState<"export" | "import">(initialTab);

  return (
    <TabsDialog
      title="Import / Export Connections"
      description="Move connections between machines as an encrypted JSON envelope. Passwords are never embedded — the master password is required only to wrap and unwrap the file."
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
  const groups = useConnectionStore((s) => s.groups);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(connections.map((c) => c.id)),
  );
  const [generatedPassword, setGeneratedPassword] = useState<string>("");
  const [json, setJson] = useState<string>("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<"password" | "json" | null>(
    null,
  );
  const [running, setRunning] = useState(false);

  // Wipe the generated mnemonic when the panel unmounts (dialog close).
  // Browser memory hygiene is best-effort — V8 may still hold the string
  // until GC, but clearing the React state keeps it out of any future
  // re-render snapshot or devtools inspection.
  useEffect(() => {
    return () => {
      setGeneratedPassword("");
      setJson("");
      setAcknowledged(false);
    };
  }, []);

  const generateDisabled = selected.size === 0 || running;

  const handleGenerate = async () => {
    setError(null);
    setAcknowledged(false);
    setRunning(true);
    try {
      const result = await exportConnectionsEncrypted(Array.from(selected));
      setGeneratedPassword(result.password);
      setJson(result.json);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
    setRunning(false);
  };

  const handleCopy = (text: string, target: "password" | "json") => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedTarget(target);
        window.setTimeout(() => setCopiedTarget(null), 1500);
      })
      .catch(() => {
        // Clipboard may be unavailable in some contexts (e.g. test env);
        // failure here is benign and intentionally swallowed.
      });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Select connections to include. A 12-word recovery phrase is generated
        automatically and used to encrypt the export with{" "}
        <strong>AES-256-GCM</strong> via an Argon2id key. Individual connection
        passwords are never embedded — only the data needed to recreate them.
      </p>

      <SelectionTree
        connections={connections}
        groups={groups}
        selected={selected}
        onChange={setSelected}
      />

      {generatedPassword.length === 0 && (
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={handleGenerate}
            disabled={generateDisabled}
          >
            {running ? "Generating…" : "Generate encrypted export"}
          </Button>
          {selected.size === 0 && (
            <span role="status" className="text-3xs text-muted-foreground">
              Select at least one connection.
            </span>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {generatedPassword.length > 0 && (
        <div className="space-y-3 rounded border border-warning/40 bg-warning/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle
              size={14}
              className="mt-0.5 shrink-0 text-warning"
              aria-hidden="true"
            />
            <div className="space-y-1 text-xs text-foreground">
              <p className="font-medium">
                Save this recovery phrase to your password manager now.
              </p>
              <p className="text-muted-foreground">
                It is shown <strong>only once</strong>. Without it the export
                file cannot be imported again — there is no recovery.
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="export-recovery-phrase"
              className="block text-xs font-medium text-secondary-foreground"
            >
              Recovery phrase (12 words)
            </label>
            <div className="flex items-stretch gap-2">
              <textarea
                id="export-recovery-phrase"
                className="h-16 flex-1 resize-none rounded border border-border bg-background p-2 font-mono text-xs text-foreground outline-none focus:border-primary"
                value={generatedPassword}
                readOnly
                aria-label="Generated recovery phrase"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopy(generatedPassword, "password")}
                aria-label="Copy recovery phrase"
                className="shrink-0"
              >
                {copiedTarget === "password" ? (
                  <>
                    <Check size={12} className="text-success" /> Copied
                  </>
                ) : (
                  <>
                    <Copy size={12} /> Copy
                  </>
                )}
              </Button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="size-4"
            />
            I have saved the recovery phrase somewhere safe.
          </label>
        </div>
      )}

      {json.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-secondary-foreground">
              Encrypted export
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCopy(json, "json")}
              disabled={!acknowledged}
              aria-label="Copy export JSON to clipboard"
            >
              {copiedTarget === "json" ? (
                <>
                  <Check size={12} className="text-success" /> Copied
                </>
              ) : (
                <>
                  <Copy size={12} /> Copy JSON
                </>
              )}
            </Button>
          </div>
          <textarea
            className="h-48 w-full resize-none rounded border border-border bg-background p-2 font-mono text-2xs text-foreground outline-none focus:border-primary disabled:opacity-50"
            value={acknowledged ? json : ""}
            placeholder={
              acknowledged
                ? undefined
                : "Confirm you saved the recovery phrase to reveal the export."
            }
            readOnly
            disabled={!acknowledged}
            aria-label="Generated export JSON"
          />
        </div>
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

/** Heuristic envelope detection — keeps the UI in sync with the backend
 * `import_connections_encrypted` envelope check (presence of `kdf` +
 * `ciphertext` keys). */
function looksLikeEnvelope(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      return typeof obj.kdf === "string" && typeof obj.ciphertext === "string";
    }
  } catch {
    // Not valid JSON yet — assume plain text path.
  }
  return false;
}

function ImportPanel({ onImported }: ImportPanelProps) {
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const loadGroups = useConnectionStore((s) => s.loadGroups);
  const [text, setText] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const isEnvelope = looksLikeEnvelope(text);
  const requiresPassword = isEnvelope && masterPassword.length === 0;

  const handleImport = async () => {
    setError(null);
    setResult(null);
    if (requiresPassword) {
      setError("Master password required to decrypt this envelope");
      return;
    }
    setRunning(true);
    try {
      const r = isEnvelope
        ? await importConnectionsEncrypted(text, masterPassword)
        : await importConnections(text);
      setResult(r);
      // Refresh stores so the sidebar shows the new entries
      await loadConnections();
      await loadGroups();
    } catch (e) {
      setError(extractErrorMessage(e));
    }
    setRunning(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Paste a previously-exported JSON below. Encrypted envelopes need the
        original master password; plain JSON exports are accepted unchanged for
        backward compatibility. Imported connections start{" "}
        <strong>without a password</strong>; you must edit each one before
        connecting.
      </p>

      <MasterPasswordField
        value={masterPassword}
        onChange={setMasterPassword}
        // 2026-05-05 — export는 BIP39 12-word mnemonic을 자동 생성한다.
        // 사용자 정의 password는 더 이상 만들 수 없으므로 입력 단계에서
        // 길이 검사도 무의미. 빈 값 vs 비어있지 않음만 본다.
        minLength={0}
        label="Recovery phrase"
        placeholder="12-word phrase from the original export"
        helpText={
          isEnvelope
            ? "Paste the 12-word recovery phrase shown when this file was exported."
            : "Only needed when the payload below is an encrypted envelope."
        }
      />

      <textarea
        className="h-40 w-full resize-none rounded border border-border bg-background p-2 font-mono text-2xs text-foreground outline-none focus:border-primary"
        placeholder='{"v":1,"kdf":"argon2id","alg":"aes-256-gcm",...} or {"schema_version":1,"connections":[...],"groups":[...]}'
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
        {isEnvelope && (
          <span className="text-3xs text-muted-foreground">
            Encrypted envelope detected.
          </span>
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

/** Extract a user-facing message from a Tauri invoke rejection. The
 * backend emits `AppError` as a serialised string (see `AppError::serialize`),
 * so the value Tauri rejects with is typically already the message; for
 * unexpected shapes we fall back to `String(e)`. We special-case the canonical
 * incorrect-password message so the inline text matches across the test
 * suite and the live app. */
function extractErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  // Backend includes the variant prefix `Encryption error: <msg>` — strip
  // it for the canonical wrong-password path so the user sees the clean
  // sentence and tests can assert a stable substring.
  if (raw.includes(INCORRECT_MASTER_PASSWORD_MESSAGE)) {
    return INCORRECT_MASTER_PASSWORD_MESSAGE;
  }
  return raw;
}
