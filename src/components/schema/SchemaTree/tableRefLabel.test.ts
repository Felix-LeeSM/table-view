import { describe, it, expect } from "vitest";
import { formatTableRefLabel, formatTableRefTitle } from "./tableRefLabel";

// #1218 AC4 — per-shape naming rule. Same section, three qualifications.
describe("formatTableRefLabel", () => {
  it("with-schema (PG) qualifies as schema.table", () => {
    expect(formatTableRefLabel("with-schema", "public", "users")).toBe(
      "public.users",
    );
  });

  it("no-schema (MySQL) shows the bare table (db-as-schema prefix dropped)", () => {
    expect(formatTableRefLabel("no-schema", "appdb", "orders")).toBe("orders");
  });

  it("flat (SQLite) shows the bare table", () => {
    expect(formatTableRefLabel("flat", "main", "todos")).toBe("todos");
  });

  it("with-schema falls back to bare table when schema is null", () => {
    expect(formatTableRefLabel("with-schema", null, "users")).toBe("users");
  });
});

describe("formatTableRefTitle", () => {
  it("includes db.schema.table when a schema is present", () => {
    expect(formatTableRefTitle("app", "public", "users")).toBe(
      "app.public.users",
    );
  });

  it("drops the schema segment when null", () => {
    expect(formatTableRefTitle("main.db", null, "todos")).toBe("main.db.todos");
  });
});
