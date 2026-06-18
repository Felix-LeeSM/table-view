import { logger } from "@/lib/logger";

export interface AdvisoryTimingEnv {
  runtime: string;
  userAgent: string;
  hardwareConcurrency: number | null;
}

export interface AdvisoryTimingReport {
  label: string;
  samples: number;
  p50Ms: number;
  p95Ms: number;
  env: AdvisoryTimingEnv;
}

type ProcessLike = {
  versions?: { node?: string };
  stdout?: { write: (chunk: string) => unknown };
};

function nowMs(): number {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }
  return Date.now();
}

function percentile(sortedSamples: readonly number[], ratio: number): number {
  if (sortedSamples.length === 0) return 0;
  const index = Math.min(
    sortedSamples.length - 1,
    Math.max(0, Math.ceil(sortedSamples.length * ratio) - 1),
  );
  return sortedSamples[index]!;
}

function readProcess(): ProcessLike | undefined {
  return (globalThis as typeof globalThis & { process?: ProcessLike }).process;
}

export function readAdvisoryTimingEnv(): AdvisoryTimingEnv {
  const nodeVersion = readProcess()?.versions?.node;
  return {
    runtime: nodeVersion ? `node ${nodeVersion}` : "browser-like",
    userAgent:
      typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
    hardwareConcurrency:
      typeof navigator === "undefined"
        ? null
        : (navigator.hardwareConcurrency ?? null),
  };
}

export async function measureAdvisoryTiming(
  label: string,
  samples: number,
  run: (sampleIndex: number) => void | Promise<void>,
): Promise<AdvisoryTimingReport> {
  const durations: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = nowMs();
    await run(i);
    durations.push(nowMs() - start);
  }

  durations.sort((a, b) => a - b);
  return {
    label,
    samples: durations.length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    env: readAdvisoryTimingEnv(),
  };
}

export function emitAdvisoryTiming(report: AdvisoryTimingReport): string {
  const hardwareConcurrency =
    report.env.hardwareConcurrency === null
      ? "unknown"
      : String(report.env.hardwareConcurrency);
  const line = [
    `perf advisory ${report.label}`,
    `samples=${report.samples}`,
    `p50=${report.p50Ms.toFixed(2)}ms`,
    `p95=${report.p95Ms.toFixed(2)}ms`,
    `env=runtime:${report.env.runtime};hc:${hardwareConcurrency};ua:${report.env.userAgent}`,
  ].join(" ");
  const stdout = readProcess()?.stdout;
  if (stdout) {
    stdout.write(`${line}\n`);
  } else {
    logger.info(line);
  }
  return line;
}
