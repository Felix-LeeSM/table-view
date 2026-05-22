import { describe, expect, it } from "vitest";
import {
  DATABASE_TYPE_LABELS,
  type DatabaseType,
  paradigmOf,
} from "./connection";
import { DATA_SOURCE_PROFILES, getDataSourceProfile } from "./dataSource";

describe("DataSourceProfile registry", () => {
  const allDatabaseTypes = Object.keys(DATABASE_TYPE_LABELS) as DatabaseType[];

  it("contains exactly one profile for every DatabaseType", () => {
    expect(Object.keys(DATA_SOURCE_PROFILES).sort()).toEqual(
      [...allDatabaseTypes].sort(),
    );
  });

  it("keeps every profile aligned with the current DatabaseType identity", () => {
    for (const dbType of allDatabaseTypes) {
      const profile = getDataSourceProfile(dbType);

      expect(profile.id).toBe(dbType);
      expect(profile.paradigm).toBe(paradigmOf(dbType));
      expect(profile.languages.length).toBeGreaterThan(0);
      expect(profile.resultKinds.length).toBeGreaterThan(0);
      expect(profile.capabilities).toBeDefined();
    }
  });

  it("fails deterministically for an unknown DatabaseType", () => {
    expect(() =>
      getDataSourceProfile("unknown-db" as DatabaseType),
    ).toThrowError(/Unknown data source profile/);
  });
});
