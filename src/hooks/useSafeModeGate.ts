import { useCallback } from "react";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { StatementAnalysis } from "@/lib/sql/sqlSafety";
import { decideSafeModeAction, type SafeModeDecision } from "@/lib/safeMode";
import type { ConnectionConfig } from "@/types/connection";
import {
  canonicalEnvironmentTag,
  type EnvironmentTag,
} from "@/features/connection/model";

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

type SafeModeConnection = Pick<ConnectionConfig, "id" | "environment">;

/**
 * Single environment-resolution path for every Safe Mode entry point.
 *
 * #1114 — "environment 미확정 = allow" uniformly. A missing connection
 * (unknown id, store not yet hydrated) resolves to null; there is no
 * per-call-site fail-closed override anymore, so raw query / KV / grid / DDL /
 * Mongo all read the SAME protection. Same risk = same gate at every surface.
 *
 * #1125 — canonicalize at this decision trust boundary so a non-canonical
 * stored tag (e.g. "Production", "prod") never masquerades as production and
 * never silently loses the guard. Unrecognized → null → env-unset = allow; the
 * "Unknown" ConnectionItem badge is the surfaced signal. Return type is the
 * canonical `EnvironmentTag | null` union, not a raw string, so the production
 * comparison downstream is a compiler-guarded equality.
 */
export function resolveSafeModeEnvironment(
  connections: readonly SafeModeConnection[],
  connectionId: string | null,
): EnvironmentTag | null {
  if (!connectionId) return null;
  const connection = connections.find((c) => c.id === connectionId);
  if (!connection) return null;
  return canonicalEnvironmentTag(connection.environment);
}

export function useSafeModeGate(connectionId: string | null): SafeModeGate {
  const mode = useSafeModeStore((s) => s.mode);
  const environment = useConnectionStore((s) =>
    resolveSafeModeEnvironment(s.connections, connectionId),
  );

  const decide = useCallback(
    (analysis: StatementAnalysis) =>
      decideSafeModeAction(mode, environment, analysis),
    [mode, environment],
  );

  return { decide };
}
