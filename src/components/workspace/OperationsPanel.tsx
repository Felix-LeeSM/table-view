// Issue #1054 — workspace operations flyout. Mounts the three
// connection-level ops panels (U1 ServerActivity / U4 ServerInfo /
// U5 SlowQuery) behind `operations.*` capability gates. Entry point =
// the workspace toolbar "Operations" button (see WorkspaceToolbar),
// which dispatches the same `toggle-operations-panel` custom event this
// component's parent (`MainArea`) listens for — mirroring the
// `GlobalQueryLogPanel` toggle channel so there is one consistent
// workspace-level flyout pattern.
//
// The driving connection (id / dbType / ops flags) is resolved via
// `useOperationsConnection`. When null the panel renders nothing; the
// toolbar button is also hidden in that case so the entry point and the
// surface stay in sync.
//
// ui-parity §1 (같은 작업 = 같은 진입점): server-admin views are a new
// action category that the §2 reference table did not cover; this flyout
// is the single registered entry point across paradigms, gated only by
// capability. The kill action inside `ServerActivityPanel` routes through
// `ConfirmDestructiveDialog` per AC.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@components/ui/tabs";
import ConfirmDestructiveDialog from "./ConfirmDestructiveDialog";
import { ServerActivityPanel, ServerInfoPanel } from "@features/connection";
import type { ServerActivityRow } from "@/lib/api/serverActivity";
import { SlowQueryPanel } from "@components/query/SlowQueryPanel";
import { useOperationsConnection } from "./useOperationsConnection";
import { paradigmOf } from "@/features/connection/model";

type OpsTab = "activity" | "serverInfo" | "slowQueries";

export interface OperationsPanelProps {
  visible: boolean;
  onClose: () => void;
}

export default function OperationsPanel({
  visible,
  onClose,
}: OperationsPanelProps) {
  const { t } = useTranslation("workspace");
  const drv = useOperationsConnection();
  const [active, setActive] = useState<OpsTab>("activity");

  // #1054 — kill_session confirm gate. The feature-local
  // `ServerActivityPanel` cannot import `ConfirmDestructiveDialog` (layer
  // rule), so this workspace layer owns the dialog. `requestKill` hands
  // the panel a promise that resolves true/false; the resolver ref bridges
  // the imperative dialog close back to the awaited callback.
  const [pendingKill, setPendingKill] = useState<ServerActivityRow | null>(
    null,
  );
  const killResolverRef = useRef<((ok: boolean) => void) | null>(null);

  const requestKill = useCallback((row: ServerActivityRow) => {
    setPendingKill(row);
    return new Promise<boolean>((resolve) => {
      killResolverRef.current = resolve;
    });
  }, []);

  const settleKill = useCallback((ok: boolean) => {
    setPendingKill(null);
    killResolverRef.current?.(ok);
    killResolverRef.current = null;
  }, []);

  // Auto-select the first capability-backed tab whenever the panel opens
  // or the driving connection changes so the active tab is never one the
  // current connection cannot serve.
  useEffect(() => {
    if (!visible || !drv) return;
    const order: OpsTab[] = ["activity", "serverInfo", "slowQueries"];
    if (!drv.ops[active]) {
      const first = order.find((k) => drv.ops[k]);
      if (first) setActive(first);
    }
  }, [visible, drv, active]);

  // Unmount safety: reject any dangling confirm if the panel closes.
  useEffect(() => {
    if (!visible && killResolverRef.current) {
      settleKill(false);
    }
  }, [visible, settleKill]);

  if (!visible || !drv) return null;

  const paradigm = paradigmOf(drv.dbType);

  const tabs: { key: OpsTab; label: string }[] = [];
  if (drv.ops.activity) {
    tabs.push({ key: "activity", label: t("operations.tabActivity") });
  }
  if (drv.ops.serverInfo) {
    tabs.push({ key: "serverInfo", label: t("operations.tabServerInfo") });
  }
  if (drv.ops.slowQueries) {
    tabs.push({ key: "slowQueries", label: t("operations.tabSlowQueries") });
  }

  return (
    <div
      data-testid="operations-panel"
      className="flex flex-col border-t border-border bg-secondary"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-foreground">
          {t("operations.title")}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-3xs font-medium text-muted-foreground">
          {drv.name}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Tabs value={active} onValueChange={(v) => setActive(v as OpsTab)}>
            <TabsList className="gap-0">
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.key}
                  value={tab.key}
                  data-testid={`operations-tab-${tab.key}`}
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            aria-label={t("operations.closeAria")}
            data-testid="operations-close"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="max-h-72 overflow-auto">
        {active === "activity" && drv.ops.activity ? (
          <ServerActivityPanel
            connectionId={drv.connectionId}
            dbType={drv.dbType}
            confirmKill={requestKill}
          />
        ) : active === "serverInfo" && drv.ops.serverInfo ? (
          <ServerInfoPanel
            connectionId={drv.connectionId}
            dbType={drv.dbType}
          />
        ) : active === "slowQueries" && drv.ops.slowQueries ? (
          <SlowQueryPanel connectionId={drv.connectionId} dbType={drv.dbType} />
        ) : null}
      </div>
      <ConfirmDestructiveDialog
        open={pendingKill !== null}
        reason={
          pendingKill
            ? t("operations.killReason", {
                id: pendingKill.id,
                db: pendingKill.db ?? "—",
              })
            : ""
        }
        sqlPreview={pendingKill?.query ?? ""}
        environment={
          drv.environment === "production" ? "production" : "non-production"
        }
        connectionId={drv.connectionId}
        statements={[]}
        paradigm={
          paradigm === "rdb"
            ? "rdb"
            : paradigm === "document"
              ? "document"
              : "kv"
        }
        onConfirm={() => settleKill(true)}
        onCancel={() => settleKill(false)}
      />
    </div>
  );
}
