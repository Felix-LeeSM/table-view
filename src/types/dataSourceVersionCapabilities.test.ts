import { describe, expect, it } from "vitest";
import { getDataSourceProfile } from "./dataSource";
import {
  getVersionAwareDataSourceCapabilities,
  parseDataSourceVersion,
} from "./dataSourceVersionCapabilities";

describe("version-aware data source capability gates", () => {
  it("parses common server version strings into comparable parts", () => {
    expect(parseDataSourceVersion("8.0.16")).toMatchObject({
      known: true,
      major: 8,
      minor: 0,
      patch: 16,
    });
    expect(parseDataSourceVersion("PostgreSQL 15.4")).toMatchObject({
      known: true,
      major: 15,
      minor: 4,
      patch: 0,
    });
    expect(parseDataSourceVersion(null)).toEqual({ known: false });
  });

  it("keeps ungated RDBMS capabilities stable when version is unknown", () => {
    for (const dbType of ["postgresql", "sqlite", "duckdb"] as const) {
      expect(getVersionAwareDataSourceCapabilities(dbType)).toEqual(
        getDataSourceProfile(dbType).capabilities,
      );
    }
  });

  it("downgrades MySQL-family CHECK constraint catalog support when version is unknown", () => {
    expect(getDataSourceProfile("mysql").capabilities.catalog.constraints).toBe(
      true,
    );
    expect(
      getVersionAwareDataSourceCapabilities("mysql").catalog.constraints,
    ).toBe(false);
    expect(
      getVersionAwareDataSourceCapabilities("mariadb").catalog.constraints,
    ).toBe(false);
  });

  it("enables MySQL CHECK constraint catalog support from 8.0.16", () => {
    expect(
      getVersionAwareDataSourceCapabilities("mysql", {
        version: "8.0.15",
      }).catalog.constraints,
    ).toBe(false);
    expect(
      getVersionAwareDataSourceCapabilities("mysql", {
        version: "8.0.16",
      }).catalog.constraints,
    ).toBe(true);
  });

  it("enables MariaDB CHECK constraint catalog support from 10.2.1", () => {
    expect(
      getVersionAwareDataSourceCapabilities("mariadb", {
        version: "10.2.0-MariaDB",
      }).catalog.constraints,
    ).toBe(false);
    expect(
      getVersionAwareDataSourceCapabilities("mariadb", {
        version: "10.2.1-MariaDB",
      }).catalog.constraints,
    ).toBe(true);
  });
});
