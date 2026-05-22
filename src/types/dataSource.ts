import type { DatabaseType, Paradigm } from "./connection";

export type DataParadigm = Paradigm;
export type ConnectionKind =
  | "server"
  | "file"
  | "url"
  | "cloud-api"
  | "cluster";
export type QueryLanguageId = "sql" | "mongosh" | "redis-command";
export type CatalogModelKind = "rdb" | "document" | "kv" | "search";
export type ResultEnvelopeKind =
  | "tabular"
  | "document"
  | "keyValue"
  | "stream"
  | "searchHits"
  | "aggregations";

export interface DataSourceCapabilities {
  readonly connection: Record<string, boolean>;
  readonly query: Record<string, boolean>;
  readonly catalog: Record<string, boolean>;
  readonly edit: Record<string, boolean>;
  readonly ddl: Record<string, boolean>;
  readonly intelligence: Record<string, boolean>;
  readonly operations: Record<string, boolean>;
  readonly paradigm: Record<string, boolean>;
}

export interface DataSourceProfile {
  readonly id: DatabaseType;
  readonly paradigm: DataParadigm;
  readonly connectionKind: ConnectionKind;
  readonly languages: readonly QueryLanguageId[];
  readonly catalogModel: CatalogModelKind;
  readonly resultKinds: readonly ResultEnvelopeKind[];
  readonly capabilities: DataSourceCapabilities;
  readonly safetyPolicy: string;
}

export const DATA_SOURCE_PROFILES = {} as Readonly<
  Record<DatabaseType, DataSourceProfile>
>;

export function getDataSourceProfile(dbType: DatabaseType): DataSourceProfile {
  const profile = DATA_SOURCE_PROFILES[dbType];
  if (!profile) {
    throw new Error(`Unknown data source profile: ${dbType}`);
  }
  return profile;
}
