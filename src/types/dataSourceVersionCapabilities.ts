import type { DatabaseType } from "./connection";
import {
  type DataSourceCapabilities,
  getDataSourceProfile,
} from "./dataSource";

export type DataSourceVersionInput =
  | string
  | {
      readonly major?: number | null;
      readonly minor?: number | null;
      readonly patch?: number | null;
      readonly raw?: string | null;
    }
  | null
  | undefined;

export interface DataSourceVersionContext {
  readonly version?: DataSourceVersionInput;
}

export type ParsedDataSourceVersion =
  | {
      readonly known: true;
      readonly major: number;
      readonly minor: number;
      readonly patch: number;
      readonly raw?: string;
    }
  | {
      readonly known: false;
      readonly raw?: string;
    };

export function parseDataSourceVersion(
  version: DataSourceVersionInput,
): ParsedDataSourceVersion {
  if (typeof version === "string") return { known: false, raw: version };
  return { known: false, raw: version?.raw ?? undefined };
}

export function getVersionAwareDataSourceCapabilities(
  dbType: DatabaseType,
  context: DataSourceVersionContext = {},
): DataSourceCapabilities {
  void context;
  return getDataSourceProfile(dbType).capabilities;
}
