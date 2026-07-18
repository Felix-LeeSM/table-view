import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import { DocumentTreePanel } from "@components/document/DocumentTreePanel";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import { executeKvCommand, setKvStringValue } from "@lib/tauri/kv";
import { applyTreeEdits } from "@lib/kvJsonWrite";
import { useConnectionStore } from "@stores/connectionStore";
import ConfirmDestructiveDialog from "./ConfirmDestructiveDialog";
import {
  analyzeKvMutationSafety,
  type PendingMutation,
  redisToken,
} from "./kvMutationCommands";

// KV JSON tree write core (PR3, 2026-07-18) — inline node editing for the two
// single-value key types whose value IS JSON: `string` (a JSON string, written
// with SET) and `json` (native ReJSON, written with JSON.SET). Both overwrite
// the WHOLE slot; Redis has no partial JSON patch, so we re-serialize the edited
// tree and issue one command (last-writer-wins, same semantics as the existing
// string SET editor — no WATCH/CAS).
//
// Reuses the shared write plumbing rather than adding a new path:
//   - DocumentTreePanel's 2-phase edit (pendingByPath + onCommitEdit),
//   - `applyTreeEdits` to fold the edits into a new full value,
//   - the Safe Mode gate + ConfirmDestructiveDialog for the confirm surface,
//   - `setKvStringValue` / `executeKvCommand` for execution.
// The user always sees the exact command before it runs (the preview <pre>),
// which is the data-loss mitigation for JSON round-trip normalization.

type PendingMap = Map<string, string | Record<string, unknown>>;

export interface KvJsonTreeEditorProps {
  /** The key name — the tree root label and the write target. */
  fieldName: string;
  /** Original parsed value (object/array) the tree renders and we clone. */
  original: unknown;
  /** `string` → SET, `json` → JSON.SET. */
  writeType: "string" | "json";
  connectionId: string;
  database: number;
  /** Reload the key after a successful write (delete surfaces "(missing)"). */
  onWriteSuccess: (key: string) => Promise<void> | void;
}

export function KvJsonTreeEditor({
  fieldName,
  original,
  writeType,
  connectionId,
  database,
  onWriteSuccess,
}: KvJsonTreeEditorProps) {
  const { t } = useTranslation("workspace");
  const [pending, setPending] = useState<PendingMap>(() => new Map());
  const [preview, setPreview] = useState<PendingMutation | null>(null);
  const [safeModeConfirm, setSafeModeConfirm] = useState<{
    mutation: PendingMutation;
    reason: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const safeModeGate = useSafeModeGate(connectionId);
  const connection = useConnectionStore((s) =>
    s.connections.find((c) => c.id === connectionId),
  );

  const onCommitEdit = useCallback(
    (path: string, value: string | Record<string, unknown>) => {
      setPending((prev) => {
        const next = new Map(prev);
        next.set(path, value);
        return next;
      });
      // A fresh edit invalidates any built command awaiting confirmation.
      setPreview(null);
      setError(null);
    },
    [],
  );

  const discard = useCallback(() => {
    setPending(new Map());
    setPreview(null);
    setError(null);
  }, []);

  // Phase 1 — fold the pending edits into a new full value and build the exact
  // command. Shown to the user before anything runs.
  const buildPreview = () => {
    const { json } = applyTreeEdits(original, pending);
    const command =
      writeType === "json"
        ? `JSON.SET ${redisToken(fieldName)} $ ${redisToken(json)}`
        : `SET ${redisToken(fieldName)} ${redisToken(json)}`;
    setError(null);
    setPreview(
      writeType === "json"
        ? { kind: "command", label: "JSON.SET", summary: command, command }
        : {
            kind: "string",
            label: "String set",
            summary: command,
            value: json,
          },
    );
  };

  // Phase 2 — route the built command through the same Safe Mode gate the
  // manual mutation panel uses. non-prod safe write → runs after this explicit
  // Confirm; production / danger → the confirm dialog.
  const confirmWrite = () => {
    if (!preview) return;
    const decision = safeModeGate.decide(
      analyzeKvMutationSafety(preview, fieldName),
    );
    if (decision.action === "confirm") {
      setSafeModeConfirm({ mutation: preview, reason: decision.reason });
      return;
    }
    if (decision.action === "block") {
      setError(decision.reason);
      return;
    }
    void execute(preview);
  };

  const execute = async (mutation: PendingMutation) => {
    setSaving(true);
    setError(null);
    try {
      if (mutation.kind === "string") {
        await setKvStringValue(connectionId, {
          database,
          key: fieldName,
          value: mutation.value ?? "",
          safety: "allowOverwrite",
        });
      } else {
        await executeKvCommand(connectionId, {
          database,
          command: mutation.command ?? "",
        });
      }
      setPending(new Map());
      setPreview(null);
      setSafeModeConfirm(null);
      await onWriteSuccess(fieldName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmEnvironment =
    connection?.environment === "production" ? "production" : "non-production";

  return (
    <div className="space-y-2">
      <DocumentTreePanel
        value={original}
        fieldName={fieldName}
        pendingByPath={pending}
        onCommitEdit={onCommitEdit}
      />
      {pending.size > 0 && (
        <div className="space-y-2 rounded border border-border bg-background/60 p-2">
          {preview ? (
            <div className="space-y-1">
              <div className="text-3xs font-medium text-secondary-foreground">
                {t("kvKeyDetail.treeWrite.commandLabel")}
              </div>
              <pre
                aria-label={t("kvKeyDetail.treeWrite.commandLabel")}
                className="max-h-32 overflow-auto rounded border border-border bg-muted/40 p-2 text-3xs text-foreground"
              >
                {preview.summary}
              </pre>
              <div className="flex gap-2">
                <Button
                  variant="default"
                  size="xs"
                  disabled={saving}
                  onClick={confirmWrite}
                >
                  {saving
                    ? t("kvKeyDetail.treeWrite.applying")
                    : t("kvKeyDetail.treeWrite.confirmWrite")}
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  disabled={saving}
                  onClick={discard}
                >
                  {t("kvKeyDetail.treeWrite.discard")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant="secondary" size="xs" onClick={buildPreview}>
                {t("kvKeyDetail.treeWrite.save")}
              </Button>
              <Button variant="ghost" size="xs" onClick={discard}>
                {t("kvKeyDetail.treeWrite.discard")}
              </Button>
            </div>
          )}
          {error && (
            <div role="alert" className="text-3xs text-destructive">
              {error}
            </div>
          )}
        </div>
      )}
      <ConfirmDestructiveDialog
        open={safeModeConfirm !== null}
        reason={safeModeConfirm?.reason ?? ""}
        sqlPreview={safeModeConfirm?.mutation.summary ?? ""}
        environment={confirmEnvironment}
        connectionId={connectionId}
        statements={safeModeConfirm ? [safeModeConfirm.mutation.summary] : []}
        paradigm="kv"
        connectionLabel={connection?.name ?? connectionId}
        onConfirm={() => {
          if (safeModeConfirm) void execute(safeModeConfirm.mutation);
        }}
        onCancel={() => setSafeModeConfirm(null)}
      />
    </div>
  );
}
