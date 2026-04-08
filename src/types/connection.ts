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
