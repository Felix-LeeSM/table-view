import { Button } from "@components/ui/button";
import TabsDialog from "@components/ui/dialog/TabsDialog";
import { useCopyToClipboard } from "@lib/runtime/useCopyToClipboard";
import {
  exportConnectionsEncrypted,
  type ImportResult,
  importConnections,
  importConnectionsEncrypted,
} from "@lib/tauri";
import { AlertTriangle, Check, Copy, Download, Upload } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConnectionStore } from "../store";
import { sanitizeMessage } from "./ConnectionDialog/sanitize";
import MasterPasswordField from "./import-export/MasterPasswordField";
import SelectionTree from "./import-export/SelectionTree";

interface ImportExportDialogProps {
  onClose: () => void;
  /** Optional initial tab. Defaults to "export". */
  initialTab?: "export" | "import";
}
/**
 * Canonical message rendered inline when the user enters the wrong master
 * password. The backend emits the same string from
 * `AppError::Encryption("Incorrect master password — the file could not be
 * decrypted")`. Tests assert that this exact string makes it to the UI
 * surface.
 */
const INCORRECT_MASTER_PASSWORD_MESSAGE =
  "Incorrect master password — the file could not be decrypted";

/**
 * Issue #2438 — both panes are a two-column grid: the left column carries
 * "what" (the selection tree / the pasted payload), the right column carries
 * "how" (master password, acknowledgement, actions, results). Below the `md`
 * breakpoint the tracks collapse to a single column so a narrow window keeps
 * the old vertical stack instead of squeezing two columns.
 */
const PANE_GRID_CLASS =
  "grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]";
const PANE_HEADING_CLASS =
  "text-3xs font-semibold uppercase tracking-wide text-muted-foreground";

/**
 * The split needs a wider shell than the old `w-dialog-lg`. This is the same
 * cap `BlobViewerDialog` — the other `TabsDialog` caller — uses, and the
 * Layer-1 `max-w-[calc(100%-2rem)]` still shrinks it on a narrow window.
 */
const DIALOG_WIDTH_CLASS = "bg-secondary sm:max-w-3xl";

/**
 * Migrated to the `TabsDialog` preset. The Export/Import panes keep their
 * bodies; the preset owns the title + tab list + dialog shell.
 * Issue #2438 kept the preset untouched — its `content` slot already takes an
 * arbitrary node, so the left/right split lives in the panes below and no
 * other `TabsDialog` caller is affected.
 *
 * The Export pane wraps the selection in a master-password envelope
 * (Argon2id + AES-256-GCM) instead of emitting plain JSON; the Import pane
 * auto-detects envelope vs plain payload and surfaces the shared "Incorrect
 * master password" message on a wrong-password failure.
 *
 * 2026-05-05: in the Export pane the user does not type a password. The
 * backend auto-generates a BIP39 12-word mnemonic and returns it with the
 * envelope; the user stores the mnemonic in a password manager and must
 * explicitly acknowledge that responsibility with the checkbox before moving
 * on. When the dialog closes the mnemonic leaves React state (browser memory
 * hygiene is best-effort).
 */
export default function ImportExportDialog({
  onClose,
  initialTab = "export",
}: ImportExportDialogProps) {
  const { t } = useTranslation("featuresConnection");
  const [tab, setTab] = useState<"export" | "import">(initialTab);

  return (
    <TabsDialog
      title={t("importExport.title")}
      description={t("importExport.description")}
      className={DIALOG_WIDTH_CLASS}
      onClose={onClose}
      value={tab}
      onTabChange={(v) => setTab(v as "export" | "import")}
      tabs={[
        {
          value: "export",
          label: t("importExport.tabExport"),
          triggerNode: (
            <span className="inline-flex items-center gap-1.5">
              <Download size={12} /> {t("importExport.tabExport")}
            </span>
          ),
          content: <ExportPanel />,
        },
        {
          value: "import",
          label: t("importExport.tabImport"),
          triggerNode: (
            <span className="inline-flex items-center gap-1.5">
              <Upload size={12} /> {t("importExport.tabImport")}
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
  const { t } = useTranslation("featuresConnection");
  const connections = useConnectionStore((s) => s.connections);
  const groups = useConnectionStore((s) => s.groups);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(connections.map((c) => c.id)),
  );
  const [generatedPassword, setGeneratedPassword] = useState<string>("");
  const [json, setJson] = useState<string>("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { copiedKey: copiedTarget, copy } = useCopyToClipboard<
    "password" | "json"
  >();
  const [running, setRunning] = useState(false);
  const whatId = useId();
  const howId = useId();

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
      setError(extractErrorMessage(e, generatedPassword));
    }
    setRunning(false);
  };

  const handleCopy = (text: string, target: "password" | "json") =>
    void copy(text, target);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t("importExport.exportIntro")}
      </p>

      <div className={PANE_GRID_CLASS}>
        <section aria-labelledby={whatId} className="min-w-0 space-y-2">
          <h3 id={whatId} className={PANE_HEADING_CLASS}>
            {t("importExport.paneExportWhat")}
          </h3>
          <SelectionTree
            connections={connections}
            groups={groups}
            selected={selected}
            onChange={setSelected}
          />
        </section>

        <section aria-labelledby={howId} className="min-w-0 space-y-3">
          <h3 id={howId} className={PANE_HEADING_CLASS}>
            {t("importExport.paneExportOptions")}
          </h3>

          {generatedPassword.length === 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={handleGenerate}
                disabled={generateDisabled}
              >
                {running
                  ? t("importExport.generating")
                  : t("importExport.generateExport")}
              </Button>
              {selected.size === 0 && (
                <span role="status" className="text-3xs text-muted-foreground">
                  {t("importExport.selectAtLeastOne")}
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
                    {t("importExport.saveRecoveryTitle")}
                  </p>
                  <p className="text-muted-foreground">
                    {t("importExport.saveRecoveryBody")}
                  </p>
                </div>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="export-recovery-phrase"
                  className="block text-xs font-medium text-secondary-foreground"
                >
                  {t("importExport.labelRecoveryPhrase")}
                </label>
                <div className="flex items-stretch gap-2">
                  <textarea
                    id="export-recovery-phrase"
                    className="h-16 flex-1 resize-none rounded border border-border bg-background p-2 font-mono text-xs text-foreground outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring"
                    value={generatedPassword}
                    readOnly
                    aria-label={t("importExport.ariaRecoveryPhrase")}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(generatedPassword, "password")}
                    aria-label={t("importExport.copyRecoveryAria")}
                    className="shrink-0"
                  >
                    {copiedTarget === "password" ? (
                      <>
                        <Check
                          size={12}
                          className="text-success"
                          aria-hidden="true"
                        />{" "}
                        {t("importExport.copied")}
                      </>
                    ) : (
                      <>
                        <Copy size={12} /> {t("importExport.copy")}
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
                {t("importExport.acknowledgeLabel")}
              </label>
            </div>
          )}

          {json.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-secondary-foreground">
                  {t("importExport.labelEncryptedExport")}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopy(json, "json")}
                  disabled={!acknowledged}
                  aria-label={t("importExport.copyJsonAria")}
                >
                  {copiedTarget === "json" ? (
                    <>
                      <Check
                        size={12}
                        className="text-success"
                        aria-hidden="true"
                      />{" "}
                      {t("importExport.copied")}
                    </>
                  ) : (
                    <>
                      <Copy size={12} /> {t("importExport.copyJson")}
                    </>
                  )}
                </Button>
              </div>
              <textarea
                className="h-48 w-full resize-none rounded border border-border bg-background p-2 font-mono text-2xs text-foreground outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                value={acknowledged ? json : ""}
                placeholder={
                  acknowledged
                    ? undefined
                    : t("importExport.exportJsonPlaceholder")
                }
                readOnly
                disabled={!acknowledged}
                aria-label={t("importExport.ariaExportJson")}
              />
            </div>
          )}
        </section>
      </div>
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
  const { t } = useTranslation("featuresConnection");
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const loadGroups = useConnectionStore((s) => s.loadGroups);
  const [text, setText] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const whatId = useId();
  const howId = useId();

  const isEnvelope = looksLikeEnvelope(text);
  const requiresPassword = isEnvelope && masterPassword.length === 0;

  const handleImport = async () => {
    setError(null);
    setResult(null);
    if (requiresPassword) {
      setError(t("importExport.errorMasterPasswordRequired"));
      return;
    }
    setRunning(true);
    try {
      // backward-compatible import: the plain `importConnections` path accepts
      // unencrypted JSON exports from older app versions unchanged; only
      // envelopes require the master password. The frontend-compat inventory
      // (refactor-02) tracks this file by this marker — the user-facing help
      // text moved to the locale files, so the compat behavior is described in
      // this code comment to keep the marker.
      const r = isEnvelope
        ? await importConnectionsEncrypted(text, masterPassword)
        : await importConnections(text);
      setResult(r);
      // Refresh stores so the sidebar shows the new entries
      await loadConnections();
      await loadGroups();
    } catch (e) {
      setError(extractErrorMessage(e, masterPassword));
    }
    setRunning(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t("importExport.importIntro")}
      </p>

      <div className={PANE_GRID_CLASS}>
        <section aria-labelledby={whatId} className="min-w-0 space-y-2">
          <h3 id={whatId} className={PANE_HEADING_CLASS}>
            {t("importExport.paneImportWhat")}
          </h3>

          {/* eslint-disable no-restricted-syntax -- the placeholder is an import JSON format example (technical tokens), not a translation target (#1074) */}
          <textarea
            className="h-40 w-full resize-none rounded border border-border bg-background p-2 font-mono text-2xs text-foreground outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring"
            placeholder='{"v":1,"kdf":"argon2id","alg":"aes-256-gcm",...} or {"schema_version":1,"connections":[...],"groups":[...]}'
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={t("importExport.ariaImportJson")}
          />
          {/* eslint-enable no-restricted-syntax */}

          {/* Import has no list until a payload arrives — the export pane's
              counterpart is the selection tree. Until then the left column
              says so instead of standing empty. */}
          {text.trim().length === 0 && (
            <p role="status" className="text-3xs text-muted-foreground">
              {t("importExport.importEmptyState")}
            </p>
          )}
          {isEnvelope && (
            <p className="text-3xs text-muted-foreground">
              {t("importExport.envelopeDetected")}
            </p>
          )}
        </section>

        <section aria-labelledby={howId} className="min-w-0 space-y-3">
          <h3 id={howId} className={PANE_HEADING_CLASS}>
            {t("importExport.paneImportOptions")}
          </h3>

          <MasterPasswordField
            value={masterPassword}
            onChange={setMasterPassword}
            // 2026-05-05 — export auto-generates a BIP39 12-word mnemonic.
            // A user-defined password can no longer be created, so a length
            // check at input time is pointless; only empty vs non-empty
            // matters.
            minLength={0}
            label={t("importExport.mpLabel")}
            placeholder={t("importExport.mpPlaceholder")}
            helpText={
              isEnvelope
                ? t("importExport.mpHelpEnvelope")
                : t("importExport.mpHelpPlain")
            }
          />

          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={handleImport}
              disabled={running || !text.trim()}
            >
              {running
                ? t("importExport.importing")
                : t("importExport.importButton")}
            </Button>
            {result && (
              <Button variant="outline" size="sm" onClick={onImported}>
                {t("importExport.done")}
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
        </section>
      </div>
    </div>
  );
}

function ImportResultPanel({ result }: { result: ImportResult }) {
  const { t } = useTranslation("featuresConnection");
  const renamedCount = result.renamed.length;
  const skippedCount = result.skipped_groups.length;
  const createdGroupCount = result.created_groups.length;

  return (
    <div className="space-y-2 rounded border border-border bg-background px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <Check size={12} className="text-success" aria-hidden="true" />
        <span className="font-medium text-foreground">
          {t("importExport.resultImported", {
            count: result.imported.length,
            plural: result.imported.length === 1 ? "" : "s",
          })}
        </span>
      </div>
      {createdGroupCount > 0 && (
        <p className="text-muted-foreground">
          {t("importExport.resultCreatedGroups", {
            count: createdGroupCount,
            plural: createdGroupCount === 1 ? "" : "s",
          })}
        </p>
      )}
      {renamedCount > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">
            {t("importExport.resultNameConflicts", {
              count: renamedCount,
              plural: renamedCount === 1 ? "" : "s",
            })}
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
            {t("importExport.resultMissingGroup", {
              count: skippedCount,
              plural: skippedCount === 1 ? "" : "s",
            })}
          </summary>
          <ul className="mt-1 list-disc pl-5 text-secondary-foreground">
            {result.skipped_groups.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="border-t border-border pt-2 text-muted-foreground">
        {t("importExport.resultFooter")}
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
function extractErrorMessage(
  e: unknown,
  ...secrets: Array<string | null | undefined>
): string {
  const raw = e instanceof Error ? e.message : String(e);
  const sanitized = sanitizeMessage(raw, ...secrets);
  // Backend includes the variant prefix `Encryption error: <msg>` — strip
  // it for the canonical wrong-password path so the user sees the clean
  // sentence and tests can assert a stable substring.
  if (sanitized.includes(INCORRECT_MASTER_PASSWORD_MESSAGE)) {
    return INCORRECT_MASTER_PASSWORD_MESSAGE;
  }
  return sanitized;
}
