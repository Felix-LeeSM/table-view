import { useCallback, useEffect, useId, useState } from "react";
import { Copy, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import { executeKvCommand, readKvStream } from "@lib/tauri/kv";
import { useConnectionStore } from "@stores/connectionStore";
import type { KvStreamEntry, KvStreamReadResult } from "@/types/kv";
import ConfirmDestructiveDialog from "./ConfirmDestructiveDialog";
import { KvJsonValueCell } from "./KvJsonValueCell";
import {
  analyzeKvMutationSafety,
  buildStreamAddMutation,
  buildStreamDeleteMutation,
  buildStreamTrimMutation,
  type KvStreamFieldPair,
  type PendingMutation,
} from "./kvMutationCommands";

const STREAM_READ_DEFAULT_LIMIT = 100;
const STREAM_READ_MAX_LIMIT = 500;

const EMPTY_FIELD_PAIR: KvStreamFieldPair = { field: "", value: "" };

interface KvStreamReaderPanelProps {
  connectionId: string;
  database: number;
  stream: KvStreamReadResult;
  // Streams are append-only: XADD appends, XDEL drops a whole entry, XTRIM bounds
  // the log. All three route through the shared Safe Mode gate. When the
  // connection cannot edit keys the whole write surface is withheld (#1683 PR5b).
  mutationEnabled?: boolean;
  // Re-read the key after a write (metadata + entries refresh). Optional so the
  // read-only a11y regression tests can mount the panel without a parent.
  onMutationSuccess?: () => Promise<void>;
}

export function KvStreamReaderPanel({
  connectionId,
  database,
  stream,
  mutationEnabled = false,
  onMutationSuccess,
}: KvStreamReaderPanelProps) {
  const { t } = useTranslation("workspace");
  const [start, setStart] = useState(stream.start || "-");
  const [end, setEnd] = useState(stream.end || "+");
  const [limitText, setLimitText] = useState(
    String(clampStreamLimit(stream.limit)),
  );
  const [result, setResult] = useState<KvStreamReadResult>(stream);
  const [loading, setLoading] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const streamErrorId = useId();
  const limitInvalid = !Number.isFinite(Number.parseInt(limitText, 10));

  // Write surface (#1683 PR5b) — the add form, the trim input, and the shared
  // preview/confirm gate reused from KvMutationPanel's pure command layer.
  const [addId, setAddId] = useState("*");
  const [addFields, setAddFields] = useState<KvStreamFieldPair[]>([
    EMPTY_FIELD_PAIR,
  ]);
  const [trimText, setTrimText] = useState("");
  const [pending, setPending] = useState<PendingMutation | null>(null);
  const [safeModeConfirm, setSafeModeConfirm] = useState<{
    mutation: PendingMutation;
    reason: string;
  } | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const safeModeGate = useSafeModeGate(connectionId);
  const connection = useConnectionStore((s) =>
    s.connections.find((candidate) => candidate.id === connectionId),
  );
  const canMutate = mutationEnabled && Boolean(onMutationSuccess);

  useEffect(() => {
    setStart(stream.start || "-");
    setEnd(stream.end || "+");
    setLimitText(String(clampStreamLimit(stream.limit)));
    setResult(stream);
    setLoading(false);
    setStreamError(null);
    // A key switch or a post-mutation reload clears the write surface so a stale
    // preview never carries over to a different stream.
    setAddId("*");
    setAddFields([EMPTY_FIELD_PAIR]);
    setTrimText("");
    setPending(null);
    setSafeModeConfirm(null);
    setMutationError(null);
  }, [stream]);

  const refreshStream = useCallback(async () => {
    const parsedLimit = Number.parseInt(limitText, 10);
    if (!Number.isFinite(parsedLimit)) {
      setStreamError(t("kvStream.countError", { max: STREAM_READ_MAX_LIMIT }));
      return;
    }
    const limit = clampStreamLimit(parsedLimit);
    const rangeStart = start.trim() || "-";
    const rangeEnd = end.trim() || "+";
    setLoading(true);
    setStreamError(null);
    try {
      const next = await readKvStream(connectionId, {
        database,
        key: stream.key,
        start: rangeStart,
        end: rangeEnd,
        limit,
      });
      setLimitText(String(next.limit));
      setResult(next);
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [connectionId, database, end, limitText, start, stream.key, t]);

  const resetGate = () => {
    setMutationError(null);
    setSafeModeConfirm(null);
  };

  const previewXadd = () => {
    resetGate();
    const id = addId.trim() || "*";
    // Drop rows with no field name; the value may legitimately be empty or JSON.
    const fields = addFields
      .map((pair) => ({ field: pair.field.trim(), value: pair.value }))
      .filter((pair) => pair.field !== "");
    if (fields.length === 0) {
      setPending(null);
      setMutationError(t("kvStream.error.addNeedsField"));
      return;
    }
    setPending(buildStreamAddMutation(stream.key, id, fields));
  };

  const previewXdel = (id: string) => {
    resetGate();
    setPending(buildStreamDeleteMutation(stream.key, id));
  };

  const previewXtrim = () => {
    resetGate();
    const raw = trimText.trim();
    if (!/^\d+$/.test(raw)) {
      setPending(null);
      setMutationError(t("kvStream.error.trimCountNotInteger"));
      return;
    }
    setPending(buildStreamTrimMutation(stream.key, Number(raw)));
  };

  // Copy-to-form (#1683) — a stream entry has no in-place field edit, so its
  // fields are copied into the XADD add form with a fresh `*` id. The user tweaks
  // and appends a new entry, then deletes the old one via XDEL separately: no
  // automatic delete rides along with a copy.
  const copyEntry = (entry: KvStreamEntry) => {
    resetGate();
    setPending(null);
    setAddId("*");
    setAddFields(
      entry.fields.length > 0
        ? entry.fields.map((field) => ({
            field: field.field,
            value: field.value,
          }))
        : [EMPTY_FIELD_PAIR],
    );
  };

  const setPair = (
    index: number,
    key: keyof KvStreamFieldPair,
    value: string,
  ) =>
    setAddFields((current) =>
      current.map((pair, idx) =>
        idx === index ? { ...pair, [key]: value } : pair,
      ),
    );
  const addPair = () =>
    setAddFields((current) => [...current, { ...EMPTY_FIELD_PAIR }]);
  const removePair = (index: number) =>
    setAddFields((current) =>
      current.length > 1 ? current.filter((_, idx) => idx !== index) : current,
    );

  const confirmPending = () => {
    if (!pending) return;
    const decision = safeModeGate.decide(
      analyzeKvMutationSafety(pending, stream.key),
    );
    if (decision.action === "confirm") {
      setSafeModeConfirm({ mutation: pending, reason: decision.reason });
      return;
    }
    if (decision.action === "block") {
      setMutationError(decision.reason);
      return;
    }
    void runCommand(pending);
  };

  const runCommand = async (mutation: PendingMutation) => {
    if (!onMutationSuccess) return;
    setSaving(true);
    setMutationError(null);
    try {
      await executeKvCommand(connectionId, {
        database,
        command: mutation.command ?? "",
      });
      setPending(null);
      setSafeModeConfirm(null);
      await onMutationSuccess();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmEnvironment =
    connection?.environment === "production" ? "production" : "non-production";
  const connectionLabel = connection?.name ?? connectionId;
  const fieldClass =
    "min-w-0 rounded border border-border bg-background px-2 py-1 text-3xs text-foreground outline-none";

  return (
    <div className="rounded border border-border bg-muted/20">
      <div className="grid gap-2 border-b border-border p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem_auto]">
        <label className="grid min-w-0 gap-1 text-3xs text-muted-foreground">
          {t("kvStream.startLabel")}
          <input
            className="min-w-0 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            placeholder="-"
          />
        </label>
        <label className="grid min-w-0 gap-1 text-3xs text-muted-foreground">
          {t("kvStream.endLabel")}
          <input
            className="min-w-0 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            placeholder="+"
          />
        </label>
        <label className="grid min-w-0 gap-1 text-3xs text-muted-foreground">
          {t("kvStream.countLabel")}
          <input
            className="min-w-0 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
            type="number"
            min={1}
            max={STREAM_READ_MAX_LIMIT}
            value={limitText}
            onChange={(event) => setLimitText(event.target.value)}
            aria-invalid={limitInvalid || undefined}
            // Describe the count field only when it is the invalid one and an
            // error element exists — a generic (non-field) stream error must
            // not claim to describe a valid limit input (#1333 follow-up).
            aria-describedby={
              limitInvalid && streamError ? streamErrorId : undefined
            }
          />
        </label>
        <div className="flex items-end">
          <Button
            variant="secondary"
            size="xs"
            className="w-full"
            disabled={loading}
            aria-label={t("kvStream.refreshAria")}
            onClick={() => void refreshStream()}
          >
            {loading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {t("kvStream.refresh")}
          </Button>
        </div>
      </div>

      {loading && (
        <div
          role="status"
          className="flex items-center gap-2 border-b border-border px-2 py-2 text-muted-foreground"
        >
          <Loader2 size={12} className="animate-spin" aria-hidden />
          {t("kvStream.loading")}
        </div>
      )}

      {streamError && (
        <div
          id={streamErrorId}
          role="alert"
          className="border-b border-border px-2 py-2 text-destructive"
        >
          {streamError}
        </div>
      )}

      <div className="max-h-56 overflow-auto">
        <table
          className="w-full table-fixed text-left text-3xs"
          aria-label={t("kvStream.tableAria", { key: stream.key })}
        >
          <thead className="sticky top-0 bg-muted text-muted-foreground">
            <tr>
              <th className="w-32 px-2 py-1 font-medium">
                {t("kvStream.colId")}
              </th>
              <th className="px-2 py-1 font-medium">
                {t("kvStream.colFields")}
              </th>
              {canMutate && (
                <th className="w-20 px-2 py-1 font-medium">
                  {t("kvStream.colActions")}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {result.entries.map((entry) => (
              <tr key={entry.id} className="border-t border-border">
                <td className="px-2 py-1 align-top font-mono text-foreground">
                  {entry.id}
                </td>
                <td className="px-2 py-1 align-top text-foreground">
                  <div className="flex flex-wrap gap-1">
                    {entry.fields.map((field, index) => (
                      <span
                        key={`${entry.id}:${field.field}:${index}`}
                        className="rounded bg-background px-1.5 py-0.5"
                      >
                        {field.field}=
                        <KvJsonValueCell
                          value={field.value}
                          label={field.field}
                        />
                      </span>
                    ))}
                  </div>
                </td>
                {canMutate && (
                  <td className="px-2 py-1 align-top">
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label={t("kvStream.copyEntry", { id: entry.id })}
                        onClick={() => copyEntry(entry)}
                      >
                        <Copy size={12} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label={t("kvStream.deleteEntry", { id: entry.id })}
                        onClick={() => previewXdel(entry.id)}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {result.entries.length === 0 && (
              <tr>
                <td
                  colSpan={canMutate ? 3 : 2}
                  className="border-t border-border px-2 py-3 text-muted-foreground"
                >
                  {t("kvStream.noEntries")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canMutate && (
        <div className="space-y-2 border-t border-border p-2">
          <div className="space-y-1">
            <div className="font-medium text-secondary-foreground">
              {t("kvStream.addHeader")}
            </div>
            <label className="grid gap-1 text-3xs text-muted-foreground">
              {t("kvStream.entryId")}
              <input
                className={fieldClass}
                value={addId}
                onChange={(event) => setAddId(event.target.value)}
                placeholder="*"
              />
            </label>
            {addFields.map((pair, index) => (
              <div key={index} className="flex items-center gap-1">
                <input
                  aria-label={t("kvStream.fieldName")}
                  className={fieldClass}
                  value={pair.field}
                  onChange={(event) =>
                    setPair(index, "field", event.target.value)
                  }
                  placeholder={t("kvStream.fieldName")}
                />
                <input
                  aria-label={t("kvStream.fieldValue")}
                  className={fieldClass}
                  value={pair.value}
                  onChange={(event) =>
                    setPair(index, "value", event.target.value)
                  }
                  placeholder={t("kvStream.fieldValue")}
                />
                {addFields.length > 1 && (
                  <Button
                    variant="ghost"
                    size="xs"
                    aria-label={t("kvStream.removeField")}
                    onClick={() => removePair(index)}
                  >
                    <X size={12} />
                  </Button>
                )}
              </div>
            ))}
            <div className="flex gap-1">
              <Button
                variant="secondary"
                size="xs"
                disabled={saving}
                onClick={addPair}
              >
                <Plus size={12} />
                {t("kvStream.addField")}
              </Button>
              <Button
                variant="secondary"
                size="xs"
                disabled={saving}
                onClick={previewXadd}
              >
                {t("kvStream.previewXadd")}
              </Button>
            </div>
          </div>

          <div className="grid gap-1 border-t border-border pt-2">
            <div className="font-medium text-secondary-foreground">
              {t("kvStream.trimHeader")}
            </div>
            <input
              aria-label={t("kvStream.trimCount")}
              className={fieldClass}
              value={trimText}
              onChange={(event) => setTrimText(event.target.value)}
              placeholder={t("kvStream.trimCount")}
            />
            {action(t("kvStream.previewXtrim"), previewXtrim, saving)}
          </div>

          {pending && (
            <div role="status" className="text-3xs text-secondary-foreground">
              {pending.summary}
            </div>
          )}
          {mutationError && (
            <div role="alert" className="text-3xs text-destructive">
              {mutationError}
            </div>
          )}
          {pending && (
            <Button
              variant="default"
              size="xs"
              disabled={saving}
              onClick={confirmPending}
            >
              {saving
                ? t("kvMutation.applying")
                : t("kvMutation.confirmLabel", { label: pending.label })}
            </Button>
          )}
          <ConfirmDestructiveDialog
            open={safeModeConfirm !== null}
            reason={safeModeConfirm?.reason ?? ""}
            sqlPreview={safeModeConfirm?.mutation.summary ?? ""}
            environment={confirmEnvironment}
            connectionId={connectionId}
            statements={
              safeModeConfirm ? [safeModeConfirm.mutation.summary] : []
            }
            paradigm="kv"
            connectionLabel={connectionLabel}
            onConfirm={() => {
              if (safeModeConfirm) void runCommand(safeModeConfirm.mutation);
            }}
            onCancel={() => setSafeModeConfirm(null)}
          />
        </div>
      )}
    </div>
  );
}

function action(label: string, onClick: () => void, disabled: boolean) {
  return (
    <Button variant="secondary" size="xs" disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  );
}

function clampStreamLimit(value: number | undefined): number {
  return Math.min(
    STREAM_READ_MAX_LIMIT,
    Math.max(1, Math.trunc(value ?? STREAM_READ_DEFAULT_LIMIT)),
  );
}
