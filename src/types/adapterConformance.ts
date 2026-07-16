import { DATABASE_TYPE_LABELS, type DatabaseType } from "./connection";
import {
  DATA_SOURCE_PROFILES,
  type DataSourceCapabilities,
  type DataSourceProfile,
} from "./dataSource";
import {
  getVersionAwareDataSourceCapabilities,
  type DataSourceVersionInput,
} from "./dataSourceVersionCapabilities";

export type ConformanceArea =
  | "profile"
  | "connection"
  | "catalog"
  | "query"
  | "result"
  | "edit"
  | "ddl"
  | "safety";

export type ConformanceLevel =
  | "unsupported"
  | "declared"
  | "contract"
  | "runtime";

export interface ConformanceCheck {
  readonly id: string;
  readonly area: ConformanceArea;
  readonly description: string;
}

export interface AdapterConformanceClaim {
  readonly area: ConformanceArea;
  readonly level: ConformanceLevel;
  readonly checks: readonly string[];
  readonly unsupported: readonly string[];
  readonly deferred: readonly string[];
}

export interface AdapterConformanceEntry {
  readonly dbType: DatabaseType;
  readonly level: ConformanceLevel;
  readonly areas: Readonly<Record<ConformanceArea, AdapterConformanceClaim>>;
}

export interface AdapterConformanceView {
  readonly dbType: DatabaseType;
  readonly level: ConformanceLevel;
  readonly areas: Readonly<
    Partial<Record<ConformanceArea, AdapterConformanceClaim>>
  >;
}

export interface AdapterConformanceFocus {
  readonly dbTypes?: readonly DatabaseType[];
  readonly areas?: readonly ConformanceArea[];
  readonly minLevel?: Exclude<ConformanceLevel, "unsupported">;
  readonly versionContext?: Partial<
    Record<DatabaseType, DataSourceVersionInput>
  >;
}

const CONFORMANCE_AREAS = Object.freeze([
  "profile",
  "connection",
  "catalog",
  "query",
  "result",
  "edit",
  "ddl",
  "safety",
] as const satisfies readonly ConformanceArea[]);

export const CONFORMANCE_CHECKS = Object.freeze([
  check("profile.registry", "profile", "DatabaseType has one profile entry."),
  check(
    "profile.identity",
    "profile",
    "Profile id and paradigm match DatabaseType.",
  ),
  check(
    "profile.backendAdapter",
    "profile",
    "Profile declares backend adapter family.",
  ),
  check("profile.dialect", "profile", "Profile declares dialect metadata."),
  check("connection.test", "connection", "Connection test claim is enabled."),
  check(
    "connection.switchDatabase",
    "connection",
    "Switch-database claim is enabled.",
  ),
  check(
    "connection.readOnly",
    "connection",
    "Read-only connection claim is enabled.",
  ),
  check(
    "connection.filePicker",
    "connection",
    "File-picker connection claim is enabled.",
  ),
  check("catalog.indexes", "catalog", "Index catalog claim is enabled."),
  check(
    "catalog.constraints",
    "catalog",
    "Constraint catalog claim is enabled.",
  ),
  check("query.query", "query", "Query execution claim is enabled."),
  check("query.cancel", "query", "Query cancellation claim is enabled."),
  check("query.explain", "query", "Explain-plan claim is enabled."),
  check("result.envelope", "result", "Result envelope kinds are declared."),
  check("edit.editRows", "edit", "Row-edit claim is enabled."),
  check("edit.editDocuments", "edit", "Document-edit claim is enabled."),
  check("edit.editKeys", "edit", "Key-edit claim is enabled."),
  check("edit.bulkWrite", "edit", "Bulk-write claim is enabled."),
  check("ddl.createTable", "ddl", "Create-table DDL claim is enabled."),
  check("ddl.alterTable", "ddl", "Alter-table DDL claim is enabled."),
  check("ddl.createIndex", "ddl", "Create-index DDL claim is enabled."),
  check("ddl.dropObject", "ddl", "Drop-object DDL claim is enabled."),
  check("safety.policy", "safety", "Safety policy is declared."),
] as const satisfies readonly ConformanceCheck[]);

type AreaCapabilityGroup = Exclude<
  ConformanceArea,
  "profile" | "result" | "safety"
>;

// Issue #1356 — `edit.requiresPrimaryKeyForEdit` is a write-safety *constraint*,
// not a feature the adapter claims to support, so it stays out of the
// support/unsupported conformance enumeration (a `false` value is a relaxed
// policy, not a missing capability).
const NON_CLAIM_CAPABILITY_KEYS: ReadonlySet<string> = new Set([
  "edit.requiresPrimaryKeyForEdit",
]);

const AREA_CAPABILITY_GROUP = Object.freeze({
  connection: "connection",
  catalog: "catalog",
  query: "query",
  edit: "edit",
  ddl: "ddl",
} as const satisfies Readonly<
  Record<AreaCapabilityGroup, keyof DataSourceCapabilities>
>);

const DEFERRED_FEATURES = Object.freeze({
  postgresql: noneDeferred(),
  mysql: {
    connection: [],
    catalog: ["catalog.constraints"],
    query: [],
    edit: [],
    ddl: [],
  },
  mariadb: {
    connection: [],
    catalog: ["catalog.constraints"],
    query: [],
    edit: [],
    ddl: [],
  },
  sqlite: {
    connection: [],
    // Issue #1459 — `catalog.indexes` left the deferred list: the adapter's
    // PRAGMA index_list introspection is live and the profile now claims it.
    catalog: ["catalog.constraints"],
    query: ["query.explain"],
    edit: [],
    ddl: [],
  },
  duckdb: {
    connection: [],
    catalog: ["catalog.indexes", "catalog.constraints"],
    query: ["query.cancel", "query.explain"],
    edit: [],
    ddl: [],
  },
  mssql: noneDeferred(),
  oracle: noneDeferred(),
  mongodb: {
    connection: ["connection.switchDatabase"],
    catalog: ["catalog.constraints"],
    query: [],
    edit: ["edit.editRows", "edit.editKeys"],
    ddl: [],
  },
  redis: {
    connection: [],
    catalog: ["catalog.indexes"],
    query: ["query.query", "query.cancel", "query.explain"],
    edit: ["edit.bulkWrite"],
    ddl: [],
  },
  valkey: {
    connection: [],
    catalog: ["catalog.indexes"],
    query: ["query.cancel", "query.explain"],
    edit: ["edit.bulkWrite"],
    ddl: [],
  },
  elasticsearch: {
    connection: ["connection.switchDatabase"],
    catalog: [],
    query: ["query.explain"],
    edit: ["edit.editDocuments", "edit.bulkWrite"],
    ddl: [],
  },
  opensearch: {
    connection: ["connection.switchDatabase"],
    catalog: ["catalog.indexes"],
    query: ["query.query", "query.explain"],
    edit: ["edit.editDocuments", "edit.bulkWrite"],
    ddl: [],
  },
} as const satisfies Readonly<Record<DatabaseType, DeferredByArea>>);

export const ADAPTER_CONFORMANCE_MATRIX = Object.freeze(
  mapValues(DATA_SOURCE_PROFILES, (profile) =>
    buildConformanceEntry(
      profile,
      getVersionAwareDataSourceCapabilities(profile.id),
    ),
  ),
) satisfies Readonly<Record<DatabaseType, AdapterConformanceEntry>>;

export function getAdapterConformanceMatrix(
  focus: AdapterConformanceFocus = {},
): readonly AdapterConformanceView[] {
  const dbTypes = focus.dbTypes ?? allDatabaseTypes();
  const areas = focus.areas ?? CONFORMANCE_AREAS;

  return dbTypes
    .map((dbType) =>
      focus.versionContext
        ? buildConformanceEntry(
            DATA_SOURCE_PROFILES[dbType],
            getVersionAwareDataSourceCapabilities(dbType, {
              version: focus.versionContext[dbType],
            }),
          )
        : ADAPTER_CONFORMANCE_MATRIX[dbType],
    )
    .filter((entry) => includesLevel(entry.level, focus.minLevel))
    .map((entry) =>
      freezeView({
        dbType: entry.dbType,
        level: entry.level,
        areas: Object.fromEntries(
          areas.map((area) => [area, entry.areas[area]]),
        ),
      }),
    );
}

function buildConformanceEntry(
  profile: DataSourceProfile,
  capabilities: DataSourceCapabilities,
): AdapterConformanceEntry {
  return freezeEntry({
    dbType: profile.id,
    level: entryLevel(capabilities),
    areas: {
      profile: declaredClaim("profile", [
        "profile.registry",
        "profile.identity",
        "profile.backendAdapter",
        "profile.dialect",
      ]),
      connection: runtimeClaim(profile, capabilities, "connection"),
      catalog: runtimeClaim(profile, capabilities, "catalog"),
      query: runtimeClaim(profile, capabilities, "query"),
      result: declaredClaim("result", ["result.envelope"]),
      edit: runtimeClaim(profile, capabilities, "edit"),
      ddl: runtimeClaim(profile, capabilities, "ddl"),
      safety: declaredClaim("safety", ["safety.policy"]),
    },
  });
}

function check(
  id: string,
  area: ConformanceArea,
  description: string,
): ConformanceCheck {
  return Object.freeze({ id, area, description });
}

function declaredClaim(
  area: ConformanceArea,
  checks: readonly string[],
): AdapterConformanceClaim {
  return freezeClaim({
    area,
    level: "declared",
    checks,
    unsupported: [],
    deferred: [],
  });
}

function runtimeClaim(
  profile: DataSourceProfile,
  capabilities: DataSourceCapabilities,
  area: AreaCapabilityGroup,
): AdapterConformanceClaim {
  const group = AREA_CAPABILITY_GROUP[area];
  const capabilityChecks = Object.entries(capabilities[group])
    .map(([name, supported]) => [`${group}.${name}`, supported] as const)
    .filter(([id]) => !NON_CLAIM_CAPABILITY_KEYS.has(id));
  const checks = capabilityChecks
    .filter(([, supported]) => supported)
    .map(([id]) => id);
  const deferred: readonly string[] = DEFERRED_FEATURES[profile.id][area];
  const unsupported = capabilityChecks
    .filter(([id, supported]) => !supported && !deferred.includes(id))
    .map(([id]) => id);

  return freezeClaim({
    area,
    level: checks.length > 0 ? "runtime" : "unsupported",
    checks,
    unsupported,
    deferred,
  });
}

function entryLevel(capabilities: DataSourceCapabilities): ConformanceLevel {
  const hasRuntimeWorkflow =
    Object.values(capabilities.catalog).some(Boolean) ||
    Object.values(capabilities.query).some(Boolean) ||
    Object.values(capabilities.edit).some(Boolean) ||
    Object.values(capabilities.ddl).some(Boolean);

  if (hasRuntimeWorkflow) return "runtime";
  if (capabilities.connection.test) return "contract";
  return "declared";
}

function includesLevel(
  level: ConformanceLevel,
  minLevel: AdapterConformanceFocus["minLevel"],
): boolean {
  if (!minLevel) return true;

  const rank: Record<ConformanceLevel, number> = {
    unsupported: 0,
    declared: 1,
    contract: 2,
    runtime: 3,
  };
  return rank[level] >= rank[minLevel];
}

function allDatabaseTypes(): readonly DatabaseType[] {
  return Object.keys(DATABASE_TYPE_LABELS) as DatabaseType[];
}

function freezeEntry(entry: AdapterConformanceEntry): AdapterConformanceEntry {
  Object.freeze(entry.areas);
  return Object.freeze(entry);
}

function freezeView(entry: AdapterConformanceView): AdapterConformanceView {
  Object.freeze(entry.areas);
  return Object.freeze(entry);
}

function freezeClaim(claim: AdapterConformanceClaim): AdapterConformanceClaim {
  Object.freeze(claim.checks);
  Object.freeze(claim.unsupported);
  Object.freeze(claim.deferred);
  return Object.freeze(claim);
}

function mapValues<T extends Record<string, unknown>, R>(
  source: T,
  mapper: (value: T[keyof T]) => R,
): { readonly [K in keyof T]: R } {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      mapper(value as T[keyof T]),
    ]),
  ) as { readonly [K in keyof T]: R };
}

type DeferredByArea = Readonly<Record<AreaCapabilityGroup, readonly string[]>>;

function noneDeferred(): DeferredByArea {
  return {
    connection: [],
    catalog: [],
    query: [],
    edit: [],
    ddl: [],
  };
}
