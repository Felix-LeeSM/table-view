// Sprint 339 (2026-05-15) — U4 live wire. Replaces the
// BackendPendingPlaceholder with a paradigm-neutral identity grid sourced
// from `version()` + `pg_settings` (PG) or `buildInfo` + `serverStatus`
// (Mongo). All paradigm-specific fields land in `extras` so the grid stays
// paradigm-stable.

import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { mongoRuntimeCapabilities } from "@/lib/api/mongoRuntimeCapabilities";
import { type ServerInfoRow, serverInfo } from "@/lib/api/serverInfo";
import { safeStringifyCell } from "@/lib/jsonCell";
import {
  type MongoRuntimeCapabilities,
  type MongoTopology,
  UNKNOWN_MONGO_RUNTIME_CAPABILITIES,
} from "@/types/dataSource";
import { DATABASE_TYPE_LABELS, type DatabaseType, paradigmOf } from "../model";
import { PanelLoadingSkeleton } from "./PanelLoadingSkeleton";

/**
 * Issue #1821 — deployment shape is the one server fact this panel could not
 * show. The version row above already renders `buildInfo.version`; topology
 * lives only in the capability the adapter probed at `connect()`, so it needs
 * its own (cached, round-trip-free) read.
 *
 * `"unknown"` gets a row of its own rather than being hidden: it is the state
 * in which every later version/topology gate closes, and a blank row would
 * leave the user with no way to tell "not a cluster" from "the server never
 * answered".
 *
 * Its value cell is the one in this grid without `font-mono`, on purpose: it
 * renders a translated label, not a verbatim server string like the version,
 * host and counters around it.
 */
const TOPOLOGY_LABEL_KEY: Record<MongoTopology, string> = {
  standalone: "serverInfo.topologyStandalone",
  replicaSet: "serverInfo.topologyReplicaSet",
  sharded: "serverInfo.topologySharded",
  unknown: "serverInfo.topologyUnknown",
};

export interface ServerInfoPanelProps {
  connectionId: string;
  dbType: DatabaseType;
}

export function ServerInfoPanel({
  connectionId,
  dbType,
}: ServerInfoPanelProps) {
  const { t } = useTranslation("featuresConnection");
  const paradigm = paradigmOf(dbType);
  const isMongo = dbType === "mongodb";
  const [info, setInfo] = useState<ServerInfoRow | null>(null);
  const [runtime, setRuntime] = useState<MongoRuntimeCapabilities | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The capability read is a cache hit on the adapter (probed once during
      // `connect()`), so pairing it with `server_info` adds no admin round
      // trip. The `catch` is not redundant with the wrapper's own fail-closed
      // contract: `Promise.all` rejects as a whole, so were that contract ever
      // to regress, a refused probe would blank the entire grid — host, uptime
      // and connections included. Degrading here keeps the panel's behaviour a
      // property of this file.
      const [next, capabilities] = await Promise.all([
        serverInfo(connectionId),
        isMongo
          ? mongoRuntimeCapabilities(connectionId).catch(
              () => UNKNOWN_MONGO_RUNTIME_CAPABILITIES,
            )
          : null,
      ]);
      setInfo(next);
      setRuntime(capabilities);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [connectionId, isMongo]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section
      aria-label={t("serverInfo.ariaSection")}
      data-paradigm={paradigm}
      data-testid="server-info-panel"
      className="flex flex-col gap-2 p-3"
    >
      <header className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>
          {t("serverInfo.header", { paradigm: DATABASE_TYPE_LABELS[dbType] })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="server-info-refresh"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="animate-spin" size={12} aria-hidden />
          ) : (
            <RefreshCw size={12} aria-hidden />
          )}
          {t("serverInfo.refresh")}
        </Button>
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="server-info-error"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {loading && info === null && <PanelLoadingSkeleton />}

      {!loading && error === null && info !== null && (
        <dl
          data-testid="server-info-grid"
          className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs"
        >
          <dt className="text-muted-foreground">
            {t("serverInfo.rowVersion")}
          </dt>
          <dd className="font-mono break-all">{info.version}</dd>
          {/* Gated on `isMongo` as well as on the value: when the driving
              connection changes, props arrive one render before the effect
              replaces `runtime`, and without this the frame in between paints
              a Mongo topology under a PostgreSQL connection. */}
          {isMongo && runtime !== null && (
            <>
              <dt className="text-muted-foreground">
                {t("serverInfo.rowDeployment")}
              </dt>
              <dd data-testid="server-info-deployment">
                {t(TOPOLOGY_LABEL_KEY[runtime.topology])}
              </dd>
            </>
          )}
          {info.host !== null && (
            <>
              <dt className="text-muted-foreground">
                {t("serverInfo.rowHost")}
              </dt>
              <dd className="font-mono">{info.host}</dd>
            </>
          )}
          {info.uptimeSec !== null && (
            <>
              <dt className="text-muted-foreground">
                {t("serverInfo.rowUptime")}
              </dt>
              <dd className="font-mono">{info.uptimeSec.toLocaleString()}</dd>
            </>
          )}
          {info.connectionsActive !== null && (
            <>
              <dt className="text-muted-foreground">
                {t("serverInfo.rowConnections")}
              </dt>
              <dd className="font-mono">
                {info.connectionsActive.toLocaleString()}
              </dd>
            </>
          )}
          {Object.keys(info.extras).length > 0 && (
            <>
              <dt className="col-span-2 mt-2 text-muted-foreground">
                {t("serverInfo.rowExtras")}
              </dt>
              <dd className="col-span-2 max-h-48 overflow-auto rounded-md border border-border bg-secondary/30 p-2 font-mono text-xs">
                {safeStringifyCell(info.extras, 2)}
              </dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}
