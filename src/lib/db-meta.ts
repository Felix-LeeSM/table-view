import type { DatabaseType } from "@/types/connection";

/** Metadata for each supported database type. */
export interface DbMeta {
  /** Human-readable name (e.g. "PostgreSQL"). */
  label: string;
  /** Short abbreviation for compact display (e.g. "PG"). */
  short: string;
  /** Brand color in hex (e.g. "#336791"). */
  color: string;
}

/** Unified database type metadata. Consumers pick the fields they need. */
export const DB_TYPE_META: Record<DatabaseType, DbMeta> = {
  postgresql: { label: "PostgreSQL", short: "PG", color: "#336791" },
  mysql: { label: "MySQL", short: "MY", color: "#4479A1" },
  sqlite: { label: "SQLite", short: "SQ", color: "#003B57" },
  mongodb: { label: "MongoDB", short: "MG", color: "#47A248" },
  redis: { label: "Redis", short: "RD", color: "#DC382D" },
};
