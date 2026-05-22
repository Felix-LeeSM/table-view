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

  function capabilityValues(dbType: DatabaseType): boolean[] {
    return Object.values(getDataSourceProfile(dbType).capabilities).flatMap(
      (group) => Object.values(group),
    );
  }

  it("keeps every profile aligned with the current DatabaseType identity", () => {
    for (const dbType of allDatabaseTypes) {
      const profile = getDataSourceProfile(dbType);

      expect(profile.id).toBe(dbType);
      expect(profile.paradigm).toBe(paradigmOf(dbType));
      expect(profile.languages.length).toBeGreaterThan(0);
      expect(profile.resultKinds.length).toBeGreaterThan(0);
      const capabilityValues = Object.values(profile.capabilities).flatMap(
        (group) => Object.values(group),
      );
      expect(capabilityValues.length).toBeGreaterThan(0);
    }
  });

  it("describes PostgreSQL as the current RDBMS baseline", () => {
    expect(getDataSourceProfile("postgresql").capabilities).toMatchObject({
      connection: { test: true, switchDatabase: true, readOnly: false },
      query: { query: true, multiStatement: true, cancel: true },
      catalog: {
        browse: true,
        schema: true,
        indexes: true,
        constraints: true,
        relationships: true,
      },
      edit: { editRows: true, editDocuments: false, editKeys: false },
      ddl: {
        createTable: true,
        alterTable: true,
        createIndex: true,
        dropObject: true,
      },
    });
  });

  it("keeps MariaDB capability-compatible with the MySQL-family profile", () => {
    expect(getDataSourceProfile("mariadb").capabilities).toEqual(
      getDataSourceProfile("mysql").capabilities,
    );
  });

  it("describes SQLite as a file RDBMS without switch-db or DDL parity", () => {
    const sqlite = getDataSourceProfile("sqlite");

    expect(sqlite.connectionKind).toBe("file");
    expect(sqlite.capabilities).toMatchObject({
      connection: { test: true, filePicker: true, switchDatabase: false },
      query: { query: true, multiStatement: true },
      catalog: { browse: true, schema: true, indexes: false },
      ddl: {
        createTable: false,
        alterTable: false,
        createIndex: false,
        dropObject: false,
      },
    });
  });

  it("keeps MongoDB document-scoped and separate from global switch-db", () => {
    const mongo = getDataSourceProfile("mongodb");

    expect(mongo.paradigm).toBe("document");
    expect(mongo.languages).toEqual(["mongosh"]);
    expect(mongo.capabilities).toMatchObject({
      connection: { test: true, switchDatabase: false },
      query: { query: true, multiStatement: false, cancel: false },
      catalog: { browse: true, schema: true, indexes: true },
      edit: { editRows: false, editDocuments: true, bulkWrite: true },
      ddl: { createIndex: true, dropObject: true },
    });
  });

  it("keeps unsupported profiles structurally present but capability-empty", () => {
    for (const dbType of [
      "mssql",
      "oracle",
      "redis",
    ] satisfies DatabaseType[]) {
      expect(capabilityValues(dbType).every((value) => value === false)).toBe(
        true,
      );
    }
  });

  it("exposes a read-only profile registry", () => {
    expect(Object.isFrozen(DATA_SOURCE_PROFILES)).toBe(true);

    for (const dbType of allDatabaseTypes) {
      const profile = getDataSourceProfile(dbType);

      expect(Object.isFrozen(profile)).toBe(true);
      expect(Object.isFrozen(profile.languages)).toBe(true);
      expect(Object.isFrozen(profile.resultKinds)).toBe(true);
      expect(Object.isFrozen(profile.capabilities)).toBe(true);
      for (const group of Object.values(profile.capabilities)) {
        expect(Object.isFrozen(group)).toBe(true);
      }
    }
  });

  it("fails deterministically for an unknown DatabaseType", () => {
    expect(() =>
      getDataSourceProfile("unknown-db" as DatabaseType),
    ).toThrowError(/Unknown data source profile/);
  });
});
