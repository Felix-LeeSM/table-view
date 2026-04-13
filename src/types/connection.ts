export type DatabaseType =
  | "postgresql"
  | "mysql"
  | "sqlite"
  | "mongodb"
  | "redis";

export interface ConnectionConfig {
  id: string;
  name: string;
  db_type: DatabaseType;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  group_id: string | null;
  color: string | null;
  connection_timeout?: number;
  keep_alive_interval?: number;
}

export interface ConnectionGroup {
  id: string;
  name: string;
  color: string | null;
  collapsed: boolean;
}

/// Adjacently-tagged discriminated union matching Rust's serde serialization:
/// - { type: "connected" }
/// - { type: "disconnected" }
/// - { type: "error", message: "..." }
export type ConnectionStatus =
  | { type: "connected" }
  | { type: "connecting" }
  | { type: "disconnected" }
  | { type: "error"; message: string };

export const DATABASE_DEFAULTS: Record<DatabaseType, number> = {
  postgresql: 5432,
  mysql: 3306,
  sqlite: 0,
  mongodb: 27017,
  redis: 6379,
};

export function createEmptyConnection(): ConnectionConfig {
  return {
    id: "",
    name: "",
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "",
    database: "",
    group_id: null,
    color: null,
  };
}

export function parseConnectionUrl(
  url: string,
): Partial<ConnectionConfig> | null {
  try {
    const parsed = new URL(url);
    const dbTypeMap: Record<string, DatabaseType> = {
      postgresql: "postgresql",
      postgres: "postgresql",
      mysql: "mysql",
      mongodb: "mongodb",
      redis: "redis",
    };
    const dbType = dbTypeMap[parsed.protocol.replace(":", "")];
    if (!dbType) return null;
    return {
      db_type: dbType,
      host: parsed.hostname || "localhost",
      port: parsed.port ? parseInt(parsed.port, 10) : DATABASE_DEFAULTS[dbType],
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ""),
    };
  } catch {
    return null;
  }
}
