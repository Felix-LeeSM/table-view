import { describe, expect, it } from "vitest";
import { buildSchemaGraphCatalogSnapshot } from "./schemaGraphSnapshot";

describe("buildSchemaGraphCatalogSnapshot", () => {
  it("threads cached table indexes and constraints into SchemaGraph input", () => {
    const index = {
      name: "users_email_idx",
      columns: ["email"],
      index_type: "btree",
      is_unique: true,
      is_primary: false,
    };
    const constraint = {
      name: "users_email_key",
      constraint_type: "UNIQUE",
      columns: ["email"],
      reference_table: null,
      reference_columns: null,
    };

    const snapshot = buildSchemaGraphCatalogSnapshot({
      dbType: "postgresql",
      database: "app",
      schemas: [{ name: "public" }],
      tablesBySchema: {
        public: [{ name: "users", schema: "public", row_count: null }],
      },
      columnsByTable: {
        public: {
          users: [
            {
              name: "email",
              data_type: "text",
              nullable: false,
              default_value: null,
              is_primary_key: false,
              is_foreign_key: false,
              fk_reference: null,
              comment: null,
            },
          ],
        },
      },
      indexesByTable: { public: { users: [index] } },
      constraintsByTable: { public: { users: [constraint] } },
    });

    expect(snapshot.indexesByTable?.public?.users).toEqual([index]);
    expect(snapshot.constraintsByTable?.public?.users).toEqual([constraint]);
  });
});
