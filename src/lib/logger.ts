/**
 * DEV-only console wrapper. Centralises the `import.meta.env.DEV` gate
 * so production builds emit no console noise and there's a single
 * fan-out point for future telemetry / native log channels.
 *
 * The boot-summary line in `src/lib/perf/bootInstrumentation.ts` is the
 * one deliberate exception — that single `console.info` is a
 * production-kept structured-diagnostics contract.
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
