export type Target =
  | "all"
  | "pg"
  | "mongo"
  | "mysql"
  | "sqlite"
  | "duckdb"
  | "mariadb"
  | "mssql"
  | "oracle"
  | "redis";

export type ConcreteTarget = Exclude<Target, "all">;

const TARGET_NAMES: Record<string, Target> = {
  all: "all",
  pg: "pg",
  postgres: "pg",
  postgresql: "pg",
  mongo: "mongo",
  mongodb: "mongo",
  mysql: "mysql",
  sqlite: "sqlite",
  duckdb: "duckdb",
  mariadb: "mariadb",
  mssql: "mssql",
  oracle: "oracle",
  redis: "redis",
};

const DEFAULT_TARGETS = new Set<ConcreteTarget>([
  "pg",
  "mongo",
  "mysql",
  "sqlite",
  "duckdb",
  "mariadb",
  "mssql",
  "oracle",
  "redis",
]);

export function targetMode(options: Record<string, string | boolean>): Target {
  const t = options.target;
  if (typeof t === "string" && TARGET_NAMES[t]) return TARGET_NAMES[t]!;
  return "all";
}

export function shouldRunTarget(
  selected: Target,
  candidate: ConcreteTarget,
): boolean {
  if (selected === "all") return DEFAULT_TARGETS.has(candidate);
  return selected === candidate;
}
