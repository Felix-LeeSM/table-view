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

type MutableCapabilityGroup<T> = {
  -readonly [Key in keyof T]: T[Key];
};

type MutableCapabilities = {
  -readonly [Group in keyof DataSourceCapabilities]: MutableCapabilityGroup<
    DataSourceCapabilities[Group]
  >;
};

export function parseDataSourceVersion(
  version: DataSourceVersionInput,
): ParsedDataSourceVersion {
  if (!version) return { known: false };

  if (typeof version === "object") {
    if (Number.isInteger(version.major)) {
      return {
        known: true,
        major: version.major ?? 0,
        minor: version.minor ?? 0,
        patch: version.patch ?? 0,
        raw: version.raw ?? undefined,
      };
    }
    return { known: false, raw: version.raw ?? undefined };
  }

  const comparableVersion = normalizeVersionString(version);
  const match = comparableVersion.match(/\d+(?:\.\d+){0,2}/);
  if (!match) return { known: false, raw: version };

  const [major = 0, minor = 0, patch = 0] = match[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10));

  if (!Number.isInteger(major)) return { known: false, raw: version };

  return {
    known: true,
    major,
    minor,
    patch,
    raw: version,
  };
}

function normalizeVersionString(version: string): string {
  if (/mariadb/i.test(version)) {
    return version.replace(/^5\.5\.5-/, "");
  }
  return version;
}

export function getVersionAwareDataSourceCapabilities(
  dbType: DatabaseType,
  context: DataSourceVersionContext = {},
): DataSourceCapabilities {
  const capabilities = cloneCapabilities(
    getDataSourceProfile(dbType).capabilities,
  );
  const version = parseDataSourceVersion(context.version);

  applyMysqlFamilyCheckConstraintGate(dbType, capabilities, version);

  return freezeCapabilities(capabilities);
}

function applyMysqlFamilyCheckConstraintGate(
  dbType: DatabaseType,
  capabilities: MutableCapabilities,
  version: ParsedDataSourceVersion,
) {
  if (dbType !== "mysql" && dbType !== "mariadb") return;

  capabilities.catalog.constraints =
    version.known &&
    (dbType === "mysql"
      ? isAtLeast(version, 8, 0, 16)
      : isAtLeast(version, 10, 2, 1));
}

function isAtLeast(
  version: Extract<ParsedDataSourceVersion, { known: true }>,
  major: number,
  minor: number,
  patch: number,
): boolean {
  return (
    version.major > major ||
    (version.major === major &&
      (version.minor > minor ||
        (version.minor === minor && version.patch >= patch)))
  );
}

function cloneCapabilities(
  capabilities: DataSourceCapabilities,
): MutableCapabilities {
  return {
    connection: { ...capabilities.connection },
    query: { ...capabilities.query },
    catalog: { ...capabilities.catalog },
    edit: { ...capabilities.edit },
    ddl: { ...capabilities.ddl },
    intelligence: { ...capabilities.intelligence },
    operations: { ...capabilities.operations },
  };
}

function freezeCapabilities(
  capabilities: MutableCapabilities,
): DataSourceCapabilities {
  Object.freeze(capabilities.connection);
  Object.freeze(capabilities.query);
  Object.freeze(capabilities.catalog);
  Object.freeze(capabilities.edit);
  Object.freeze(capabilities.ddl);
  Object.freeze(capabilities.intelligence);
  Object.freeze(capabilities.operations);
  return Object.freeze(capabilities);
}
