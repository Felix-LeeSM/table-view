// Sprint 327 (2026-05-15) — U4 scaffolding. Server info panel (version,
// host, uptime, connections, replication). RDB can derive everything from
// pg_settings + version() via execute_query; Mongo needs `buildInfo` +
// `serverStatus` runCommand wrappers (Sprint 335).

import { BackendPendingPlaceholder } from "@/components/shared/BackendPendingPlaceholder";

export interface ServerInfoPanelProps {
  connectionId: string;
  paradigm: "table" | "document";
}

export function ServerInfoPanel({
  connectionId,
  paradigm,
}: ServerInfoPanelProps) {
  return (
    <section
      aria-label="Server info"
      data-paradigm={paradigm}
      data-testid="server-info-panel"
    >
      <BackendPendingPlaceholder
        title="Server info"
        pendingSprint="Sprint 335"
        description={
          paradigm === "document"
            ? `Mongo buildInfo + serverStatus wrappers pending (conn ${connectionId}).`
            : `RDB pg_settings + version() wiring pending (conn ${connectionId}).`
        }
        testId="server-info-placeholder"
      />
    </section>
  );
}
