import type { DatabaseType } from "./connection";

export type ConformanceArea = "profile" | "query" | "catalog";
export type ConformanceLevel = "unsupported" | "supported";

export interface ConformanceCheck {
  readonly id: string;
  readonly area: ConformanceArea;
}

export interface AdapterConformanceClaim {
  readonly area: ConformanceArea;
  readonly level: ConformanceLevel;
  readonly checks: readonly string[];
  readonly unsupported: readonly string[];
}

export interface AdapterConformanceEntry {
  readonly dbType: DatabaseType;
  readonly areas: Readonly<Record<ConformanceArea, AdapterConformanceClaim>>;
}

export const CONFORMANCE_CHECKS: readonly ConformanceCheck[] = [];

export const ADAPTER_CONFORMANCE_MATRIX = Object.freeze({}) as Readonly<
  Record<DatabaseType, AdapterConformanceEntry>
>;

export function getAdapterConformanceMatrix(_options?: {
  readonly dbTypes?: readonly DatabaseType[];
  readonly areas?: readonly ConformanceArea[];
}): readonly AdapterConformanceEntry[] {
  void _options;
  return [];
}
