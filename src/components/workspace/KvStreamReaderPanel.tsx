import { useCallback, useEffect, useId, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import { readKvStream } from "@lib/tauri/kv";
import type { KvStreamReadResult } from "@/types/kv";
import { KvJsonValueCell } from "./KvJsonValueCell";

const STREAM_READ_DEFAULT_LIMIT = 100;
const STREAM_READ_MAX_LIMIT = 500;

interface KvStreamReaderPanelProps {
  connectionId: string;
  database: number;
  stream: KvStreamReadResult;
}

export function KvStreamReaderPanel({
  connectionId,
  database,
  stream,
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

  useEffect(() => {
    setStart(stream.start || "-");
    setEnd(stream.end || "+");
    setLimitText(String(clampStreamLimit(stream.limit)));
    setResult(stream);
    setLoading(false);
    setStreamError(null);
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
              </tr>
            ))}
            {result.entries.length === 0 && (
              <tr>
                <td
                  colSpan={2}
                  className="border-t border-border px-2 py-3 text-muted-foreground"
                >
                  {t("kvStream.noEntries")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function clampStreamLimit(value: number | undefined): number {
  return Math.min(
    STREAM_READ_MAX_LIMIT,
    Math.max(1, Math.trunc(value ?? STREAM_READ_DEFAULT_LIMIT)),
  );
}
