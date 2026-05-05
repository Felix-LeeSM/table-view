/**
 * Sprint 204 — DEV-only console wrapper. Centralizes the
 * `import.meta.env.DEV` gate so production builds emit no console noise
 * and the project has one fan-out point for future telemetry / native log
 * channels.
 *
 * Migrated from 13 ad-hoc `console.*` call sites (CODE_SMELLS §5). The one
 * deliberate exception — `src/lib/perf/bootInstrumentation.ts:187` — keeps
 * its direct `console.info` because Sprint 175 pinned that single
 * production line as a structured boot-summary invariant.
 */

export interface Logger {
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  info(...args: unknown[]): void;
}

/**
 * Build a logger that forwards to `console.*` only when `isDev` is true.
 * Exported for tests so both DEV and prod gating can be exercised without
 * touching `import.meta.env`.
 */
export function makeLogger(isDev: boolean): Logger {
  return {
    warn(...args: unknown[]): void {
      if (isDev) console.warn(...args);
    },
    error(...args: unknown[]): void {
      if (isDev) console.error(...args);
    },
    info(...args: unknown[]): void {
      if (isDev) console.info(...args);
    },
  };
}

export const logger: Logger = makeLogger(import.meta.env.DEV);
