import { useCallback } from "react";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { StatementAnalysis } from "@/lib/sql/sqlSafety";
import { decideSafeModeAction, type SafeModeDecision } from "@/lib/safeMode";
import type { ConnectionConfig } from "@/types/connection";
import { canonicalEnvironmentTag } from "@/features/connection/model";

/**
 * Paradigm-agnostic Safe Mode gate. Pure store wiring around
 * `decideSafeModeAction` (`src/lib/safeMode.ts`); both Mongo aggregate
 * and the RDB grid / DDL editors share the same decision matrix.
 *
 * Policy (Sprint 245 — ADR 0022 Phase 1, destructive-only):
 *
 * | env             | mode    | statement                       | result   |
 * |-----------------|---------|---------------------------------|----------|
 * | non-production  | strict  | destructive                     | confirm  |
 * | non-production  | strict  | safe write / read               | allow    |
 * | non-production  | warn    | *                               | allow    |
 * | non-production  | off     | *                               | allow    |
 * | production      | *       | safe write / read               | allow    |
 * | production      | strict  | destructive                     | confirm  |
 * | production      | warn    | destructive                     | confirm  |
 * | production      | off     | destructive                     | confirm  |
 *
 * Sprint 244's "production + strict | off = read-only" was reverted —
 * INSERT / UPDATE WHERE / CREATE / ALTER additive flow without a
 * confirm dialog on production. Cmd+Z (Phase 5) is the safety net for
 * commit-time safe writes; the destructive dialog (Phase 2) handles the
 * unrecoverable cases. See `src/lib/safeMode.ts` for the canonical
 * matrix + reason copy.
 */
export type { SafeModeDecision };

export interface SafeModeGate {
  decide(analysis: StatementAnalysis): SafeModeDecision;
}

export interface SafeModeGateOptions {
  missingConnectionEnvironment?: string | null;
}

type SafeModeConnection = Pick<ConnectionConfig, "id" | "environment">;

export function resolveSafeModeEnvironment(
  connections: readonly SafeModeConnection[],
  connectionId: string | null,
  missingConnectionEnvironment: string | null = null,
): string | null {
  if (!connectionId) return null;
  const connection = connections.find((c) => c.id === connectionId);
  // #1125 — canonicalize at the decision trust boundary so a non-canonical
  // stored tag (e.g. "Production", "prod") never masquerades as production
  // and never silently loses the guard. Unrecognized → null → env-unset =
  // allow (#1114 policy); the "Unknown" badge is the surfaced signal.
  if (!connection) return canonicalEnvironmentTag(missingConnectionEnvironment);
  return canonicalEnvironmentTag(connection.environment);
}

export function useSafeModeGate(
  connectionId: string | null,
  options: SafeModeGateOptions = {},
): SafeModeGate {
  const mode = useSafeModeStore((s) => s.mode);
  const missingConnectionEnvironment =
    options.missingConnectionEnvironment ?? null;
  const environment = useConnectionStore((s) =>
    resolveSafeModeEnvironment(
      s.connections,
      connectionId,
      missingConnectionEnvironment,
    ),
  );

  const decide = useCallback(
    (analysis: StatementAnalysis) =>
      decideSafeModeAction(mode, environment, analysis),
    [mode, environment],
  );

  return { decide };
}
