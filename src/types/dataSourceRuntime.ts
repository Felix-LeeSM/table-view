import type { DatabaseType } from "./connection";

export type BackendAdapterProfileId =
  | "postgresql"
  | "mysql-family"
  | "sqlite"
  | "duckdb"
  | "mongodb"
  | "redis"
  | "declared-rdb"
  | "search-engine"
  | "marker";

export type BackendAdapterCapabilitySource =
  | "postgresql"
  | "mysql-family"
  | "sqlite"
  | "duckdb"
  | "mongodb"
  | "redis"
  | "declared-rdb"
  | "search-engine"
  | "marker";

export interface BackendAdapterProfile {
  readonly id: BackendAdapterProfileId;
  readonly kind: "rdb" | "document" | "search" | "kv";
  readonly capabilitySource: BackendAdapterCapabilitySource;
}

export type DataSourceDialectId = DatabaseType;
export type DataSourceDialectFamily =
  | "postgres"
  | "mysql"
  | "sqlite"
  | "duckdb"
  | "mssql"
  | "oracle"
  | "mongodb"
  | "redis"
  | "elasticsearch"
  | "opensearch";

export type ServerVersionProbeId =
  | "postgres-version-settings"
  | "mysql-family-version"
  | "sqlite-version"
  | "mongodb-build-info"
  | "search-root"
  | "none";

export interface DataSourceDialectMetadata {
  readonly id: DataSourceDialectId;
  readonly family: DataSourceDialectFamily;
  readonly versionProbe: ServerVersionProbeId;
}

function backendAdapterProfile(
  id: BackendAdapterProfileId,
  kind: BackendAdapterProfile["kind"],
  capabilitySource: BackendAdapterCapabilitySource,
): BackendAdapterProfile {
  return Object.freeze({
    id,
    kind,
    capabilitySource,
  });
}

const BACKEND_ADAPTER_PROFILES = Object.freeze({
  postgresql: backendAdapterProfile("postgresql", "rdb", "postgresql"),
  mysqlFamily: backendAdapterProfile("mysql-family", "rdb", "mysql-family"),
  sqlite: backendAdapterProfile("sqlite", "rdb", "sqlite"),
  duckdb: backendAdapterProfile("duckdb", "rdb", "duckdb"),
  mongodb: backendAdapterProfile("mongodb", "document", "mongodb"),
  redis: backendAdapterProfile("redis", "kv", "redis"),
  declaredRdb: backendAdapterProfile("declared-rdb", "rdb", "declared-rdb"),
  searchEngine: backendAdapterProfile(
    "search-engine",
    "search",
    "search-engine",
  ),
  markerKv: backendAdapterProfile("marker", "kv", "marker"),
});

function dialectMetadata(
  id: DataSourceDialectId,
  family: DataSourceDialectFamily,
  versionProbe: ServerVersionProbeId,
): DataSourceDialectMetadata {
  return Object.freeze({
    id,
    family,
    versionProbe,
  });
}

export const DIALECT_METADATA = Object.freeze({
  postgresql: dialectMetadata(
    "postgresql",
    "postgres",
    "postgres-version-settings",
  ),
  mysql: dialectMetadata("mysql", "mysql", "mysql-family-version"),
  mariadb: dialectMetadata("mariadb", "mysql", "mysql-family-version"),
  sqlite: dialectMetadata("sqlite", "sqlite", "sqlite-version"),
  duckdb: dialectMetadata("duckdb", "duckdb", "none"),
  mssql: dialectMetadata("mssql", "mssql", "none"),
  oracle: dialectMetadata("oracle", "oracle", "none"),
  mongodb: dialectMetadata("mongodb", "mongodb", "mongodb-build-info"),
  redis: dialectMetadata("redis", "redis", "none"),
  elasticsearch: dialectMetadata(
    "elasticsearch",
    "elasticsearch",
    "search-root",
  ),
  opensearch: dialectMetadata("opensearch", "opensearch", "search-root"),
}) satisfies Readonly<Record<DatabaseType, DataSourceDialectMetadata>>;

export const BACKEND_ADAPTER_BY_TYPE = Object.freeze({
  postgresql: BACKEND_ADAPTER_PROFILES.postgresql,
  mysql: BACKEND_ADAPTER_PROFILES.mysqlFamily,
  mariadb: BACKEND_ADAPTER_PROFILES.mysqlFamily,
  sqlite: BACKEND_ADAPTER_PROFILES.sqlite,
  duckdb: BACKEND_ADAPTER_PROFILES.duckdb,
  mssql: BACKEND_ADAPTER_PROFILES.declaredRdb,
  oracle: BACKEND_ADAPTER_PROFILES.declaredRdb,
  mongodb: BACKEND_ADAPTER_PROFILES.mongodb,
  redis: BACKEND_ADAPTER_PROFILES.redis,
  elasticsearch: BACKEND_ADAPTER_PROFILES.searchEngine,
  opensearch: BACKEND_ADAPTER_PROFILES.searchEngine,
}) satisfies Readonly<Record<DatabaseType, BackendAdapterProfile>>;
