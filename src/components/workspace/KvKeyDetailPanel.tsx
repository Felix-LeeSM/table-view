import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Timer } from "lucide-react";
import { useConnectionStore } from "@stores/connectionStore";
import { getKvValue } from "@lib/tauri/kv";
import type { KvValueEnvelope } from "@/types/kv";
import { formatKvTtl } from "@/types/kv";
import { DATABASE_TYPE_LABELS } from "@/types/connection";
import { getDataSourceProfile } from "@/types/dataSource";
import {
  canMutateKvEntries,
  canRenderKvMutationPanel,
  KvMutationPanel,
  type KvEntryActionIntent,
  type KvEntryPayload,
  type KvMutationActionIntent,
} from "./KvMutationPanel";
import { KvCollectionValueTable } from "./KvCollectionValueTable";
import { KvKeyActions } from "./KvKeyActions";
import { KvStreamReaderPanel } from "./KvStreamReaderPanel";
import { KvValueBody } from "./KvValueBody";
import { formatBytes, formatCount } from "./kvValueFormat";

const VALUE_READ_LIMIT = 100;

export interface KvKeyDetailPanelProps {
  connectionId: string;
  database: number;
  keyName: string;
}

export default function KvKeyDetailPanel({
  connectionId,
  database,
  keyName,
}: KvKeyDetailPanelProps) {
  const { t } = useTranslation("workspace");
  const connection = useConnectionStore((s) =>
    s.connections.find((c) => c.id === connectionId),
  );
  const productLabel = connection
    ? DATABASE_TYPE_LABELS[connection.dbType]
    : "Redis";
  const mutationEnabled = connection
    ? getDataSourceProfile(connection.dbType).capabilities.edit.editKeys
    : true;

  const [value, setValue] = useState<KvValueEnvelope | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationActionIntent, setMutationActionIntent] =
    useState<KvMutationActionIntent | null>(null);
  const [entryActionIntent, setEntryActionIntent] =
    useState<KvEntryActionIntent | null>(null);
  // Stale-response guard: a slow value fetch for a previous key must not
  // overwrite the current one (P5 — race determinism).
  const latestLoadRef = useRef(0);
  const mutationActionRequestRef = useRef(0);
  const entryActionRequestRef = useRef(0);

  const loadValue = useCallback(async () => {
    const loadId = latestLoadRef.current + 1;
    latestLoadRef.current = loadId;
    setLoading(true);
    setError(null);
    try {
      const envelope = await getKvValue(connectionId, {
        database,
        key: keyName,
        limit: VALUE_READ_LIMIT,
      });
      if (latestLoadRef.current !== loadId) return;
      setValue(envelope);
    } catch (err) {
      if (latestLoadRef.current !== loadId) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (latestLoadRef.current === loadId) setLoading(false);
    }
  }, [connectionId, database, keyName]);

  useEffect(() => {
    setValue(null);
    setMutationActionIntent(null);
    setEntryActionIntent(null);
    void loadValue();
  }, [loadValue]);

  const selectedMutationReady = Boolean(
    value && !loading && canRenderKvMutationPanel(value, mutationEnabled),
  );
  const requestMutationAction = (kind: KvMutationActionIntent["kind"]) => {
    if (!value || !selectedMutationReady) return;
    mutationActionRequestRef.current += 1;
    setMutationActionIntent({
      kind,
      key: value.key,
      requestId: mutationActionRequestRef.current,
    });
  };
  // #1415 — inline row edit/delete is offered only when the whole collection is
  // mutable through the panel (fully loaded, mutation enabled).
  const entriesMutable = Boolean(
    value && !loading && canMutateKvEntries(value, mutationEnabled, t),
  );
  const requestEntryAction = (
    op: "edit" | "delete",
    payload: KvEntryPayload,
  ) => {
    entryActionRequestRef.current += 1;
    setEntryActionIntent({
      op,
      payload,
      requestId: entryActionRequestRef.current,
    });
  };

  return (
    <section
      aria-label={t("kvKeyDetail.sectionAria", { key: keyName })}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-xs"
    >
      <header className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 truncate text-sm font-medium text-secondary-foreground">
            {keyName}
          </h2>
          {value && (
            <span className="inline-flex shrink-0 items-center gap-1 text-3xs text-muted-foreground">
              <Timer size={11} aria-hidden />
              {formatKvTtl(value.metadata.ttl)}
            </span>
          )}
        </div>
        {value && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-3xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5">
              {value.metadata.keyType}
            </span>
            {typeof value.metadata.length === "number" && (
              <span>
                {t("kvSidebar.itemCount", {
                  count: formatCount(value.metadata.length),
                })}
              </span>
            )}
            {typeof value.metadata.memoryBytes === "number" && (
              <span>{formatBytes(value.metadata.memoryBytes)}</span>
            )}
          </div>
        )}
      </header>

      <KvKeyActions
        productLabel={productLabel}
        selectedMutationReady={selectedMutationReady}
        onMutationAction={requestMutationAction}
      />

      {error && (
        <div
          role="alert"
          className="border-b border-border px-3 py-2 text-destructive"
        >
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {loading ? (
          <div
            role="status"
            className="flex items-center gap-2 text-muted-foreground"
          >
            <Loader2 size={12} className="animate-spin" aria-hidden />
            {t("kvSidebar.loadingValue")}
          </div>
        ) : value ? (
          <>
            {value.value.type === "stream" ? (
              <KvStreamReaderPanel
                connectionId={connectionId}
                database={database}
                stream={value.value}
              />
            ) : value.value.type === "hash" ||
              value.value.type === "list" ||
              value.value.type === "set" ||
              value.value.type === "zSet" ? (
              <KvCollectionValueTable
                keyName={value.key}
                value={value.value}
                onEntryAction={entriesMutable ? requestEntryAction : undefined}
                // PR4 — hash field / list element JSON values become tree-
                // editable (HSET/LSET) under the same mutable gate as the inline
                // row actions; loadValue re-reads the key after a write.
                writeContext={
                  entriesMutable
                    ? { connectionId, database, onWriteSuccess: loadValue }
                    : undefined
                }
              />
            ) : (
              // PR3 — string(JSON)/json single-value keys get inline node
              // editing when the connection allows edits. loadValue re-reads
              // this key after a write, mirroring KvMutationPanel below.
              <KvValueBody
                envelope={value}
                connectionId={connectionId}
                database={database}
                mutationEnabled={mutationEnabled}
                onWriteSuccess={loadValue}
              />
            )}
            {canRenderKvMutationPanel(value, mutationEnabled) && (
              <KvMutationPanel
                value={value}
                connectionId={connectionId}
                database={database}
                actionIntent={mutationActionIntent}
                entryActionIntent={entryActionIntent}
                // Panel is pinned to one key: reload our own value after a
                // mutation (delete surfaces "(missing)"). The sidebar list is
                // refreshed independently by its own Scan control.
                onMutationSuccess={loadValue}
              />
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}
