import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DatabaseType } from "./connection";
import {
  DATA_SOURCE_PROFILES,
  type DataSourceProfile,
  getDataSourceProfile,
} from "./dataSource";

const PROFILE_PARITY_REPORT_PATH = resolve(
  process.cwd(),
  "tests/fixtures/data-source-profile-parity.report.json",
);

const PROFILE_PARITY_RUNTIME_CLAIM_BOUNDARY = {
  profilePresenceIsRuntimeSupportClaim: false,
  runtimeSupportGate:
    "TS capabilities.connection.test plus adapter conformance claims; Rust adapter_contract remains backend runtime posture evidence.",
  excludedFromStrictParity: ["ts.capabilities", "rust.adapter_contract"],
} as const;

interface DataSourceProfileParityReport {
  readonly reportVersion: 1;
  readonly contract: string;
  readonly runtimeClaimBoundary: typeof PROFILE_PARITY_RUNTIME_CLAIM_BOUNDARY;
  readonly profiles: Readonly<Record<DatabaseType, ComparableProfile>>;
}

interface ComparableProfile {
  readonly id: DatabaseType;
  readonly paradigm: DataSourceProfile["paradigm"];
  readonly connectionKind: DataSourceProfile["connectionKind"];
  readonly languages: readonly string[];
  readonly catalogModel: DataSourceProfile["catalogModel"];
  readonly resultKinds: readonly string[];
  readonly safetyPolicy: DataSourceProfile["safetyPolicy"];
  readonly backendAdapter: {
    readonly id: DataSourceProfile["backendAdapter"]["id"];
    readonly kind: DataSourceProfile["backendAdapter"]["kind"];
    readonly capabilitySource: DataSourceProfile["backendAdapter"]["capabilitySource"];
  };
  readonly dialect: {
    readonly id: DataSourceProfile["dialect"]["id"];
    readonly family: DataSourceProfile["dialect"]["family"];
    readonly versionProbe: DataSourceProfile["dialect"]["versionProbe"];
  };
  readonly fileConnection: ComparableFileConnection | null;
}

interface ComparableFileConnection {
  readonly pathField: string;
  readonly readOnlyField: string;
  readonly permissionScope: string;
  readonly privacyPolicy: string;
  readonly supportedInputs: readonly ComparableFileConnectionInput[];
  readonly deferredInputs: readonly ComparableFileConnectionInput[];
}

interface ComparableFileConnectionInput {
  readonly id: string;
  readonly kind: string;
  readonly extensions: readonly string[];
  readonly status: string;
}

describe("TS/Rust data-source profile parity", () => {
  it("matches the strict comparable profile parity report", () => {
    const report = loadProfileParityReport();
    const comparableProfiles = Object.fromEntries(
      (Object.keys(DATA_SOURCE_PROFILES) as DatabaseType[])
        .sort()
        .map((dbType) => [
          dbType,
          comparableProfile(getDataSourceProfile(dbType)),
        ]),
    ) as Record<DatabaseType, ComparableProfile>;

    expect(report.reportVersion).toBe(1);
    expect(report.runtimeClaimBoundary).toEqual(
      PROFILE_PARITY_RUNTIME_CLAIM_BOUNDARY,
    );
    expect(comparableProfiles).toEqual(report.profiles);
  });
});

function loadProfileParityReport(): DataSourceProfileParityReport {
  return JSON.parse(
    readFileSync(PROFILE_PARITY_REPORT_PATH, "utf-8"),
  ) as DataSourceProfileParityReport;
}

function comparableProfile(profile: DataSourceProfile): ComparableProfile {
  return {
    id: profile.id,
    paradigm: profile.paradigm,
    connectionKind: profile.connectionKind,
    languages: sortedStrings(profile.languages),
    catalogModel: profile.catalogModel,
    resultKinds: sortedStrings(profile.resultKinds),
    safetyPolicy: profile.safetyPolicy,
    backendAdapter: {
      id: profile.backendAdapter.id,
      kind: profile.backendAdapter.kind,
      capabilitySource: profile.backendAdapter.capabilitySource,
    },
    dialect: {
      id: profile.dialect.id,
      family: profile.dialect.family,
      versionProbe: profile.dialect.versionProbe,
    },
    fileConnection: comparableFileConnection(profile.fileConnection),
  };
}

function comparableFileConnection(
  fileConnection: DataSourceProfile["fileConnection"],
): ComparableFileConnection | null {
  if (!fileConnection) return null;

  return {
    pathField: fileConnection.pathField,
    readOnlyField: fileConnection.readOnlyField,
    permissionScope: fileConnection.permissionScope,
    privacyPolicy: fileConnection.privacyPolicy,
    supportedInputs: comparableFileConnectionInputs(
      fileConnection.supportedInputs,
    ),
    deferredInputs: comparableFileConnectionInputs(
      fileConnection.deferredInputs,
    ),
  };
}

function comparableFileConnectionInputs(
  inputs: NonNullable<DataSourceProfile["fileConnection"]>["supportedInputs"],
): readonly ComparableFileConnectionInput[] {
  return inputs
    .map((input) => ({
      id: input.id,
      kind: input.kind,
      extensions: sortedStrings(input.extensions),
      status: input.status,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function sortedStrings(values: readonly string[]): readonly string[] {
  return [...values].sort();
}
