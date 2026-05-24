import { describe, expect, it } from "vitest";
import { __testing as oracleTesting } from "./oracle.js";

describe("oracle fixture DDL", () => {
  it("uses CLOB for text columns above Oracle's default VARCHAR2 limit", () => {
    const ddl = oracleTesting.buildCreateTable("support_tickets", "tickets", {
      id: { type: "uuid", primary: true },
      body: { type: "text", max_length: 5000, nullable: true },
    });

    expect(ddl).toContain("body CLOB");
    expect(ddl).not.toContain("VARCHAR2(5000)");
  });
});
