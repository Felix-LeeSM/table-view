import { useSchemaStore } from "@stores/schemaStore";

export const SCHEMA_GRAPH_IMPACT_DB = "db-1";
export const SCHEMA_GRAPH_IMPACT_SCHEMA = "public";
export const SCHEMA_GRAPH_IMPACT_USER_TABLE = "users";
export const SCHEMA_GRAPH_IMPACT_SESSION_TABLE = "sessions";
export const SCHEMA_GRAPH_IMPACT_USER_EMAIL_COLUMN = "email";
export const SCHEMA_GRAPH_IMPACT_USER_EMAIL_INDEX = "users_email_idx";
export const SCHEMA_GRAPH_IMPACT_USER_EMAIL_CONSTRAINT = "users_email_key";
export const SCHEMA_GRAPH_IMPACT_SESSION_FK = "sessions_user_email_fkey";

export function seedSchemaGraphMigrationImpactFixture(
  connectionId = "conn-1",
): void {
  useSchemaStore.setState({
    schemas: {
      [connectionId]: {
        [SCHEMA_GRAPH_IMPACT_DB]: [{ name: SCHEMA_GRAPH_IMPACT_SCHEMA }],
      },
    },
    tables: {
      [connectionId]: {
        [SCHEMA_GRAPH_IMPACT_DB]: {
          [SCHEMA_GRAPH_IMPACT_SCHEMA]: [
            table(SCHEMA_GRAPH_IMPACT_USER_TABLE),
            table(SCHEMA_GRAPH_IMPACT_SESSION_TABLE),
          ],
        },
      },
    },
    tableColumnsCache: {
      [connectionId]: {
        [SCHEMA_GRAPH_IMPACT_DB]: {
          [SCHEMA_GRAPH_IMPACT_SCHEMA]: {
            [SCHEMA_GRAPH_IMPACT_USER_TABLE]: [
              column("id", { is_primary_key: true }),
              column(SCHEMA_GRAPH_IMPACT_USER_EMAIL_COLUMN, {
                data_type: "text",
              }),
            ],
            [SCHEMA_GRAPH_IMPACT_SESSION_TABLE]: [
              column("id", { is_primary_key: true }),
              column("user_email", {
                data_type: "text",
                is_foreign_key: true,
                fk_reference: "public.users(email)",
              }),
            ],
          },
        },
      },
    },
    tableIndexesCache: {
      [connectionId]: {
        [SCHEMA_GRAPH_IMPACT_DB]: {
          [SCHEMA_GRAPH_IMPACT_SCHEMA]: {
            [SCHEMA_GRAPH_IMPACT_USER_TABLE]: [
              index("users_pkey_idx", ["id"], {
                is_primary: true,
                is_unique: true,
              }),
              index(SCHEMA_GRAPH_IMPACT_USER_EMAIL_INDEX, ["email"], {
                is_unique: true,
              }),
            ],
            [SCHEMA_GRAPH_IMPACT_SESSION_TABLE]: [
              index("sessions_user_email_idx", ["user_email"]),
            ],
          },
        },
      },
    },
    tableConstraintsCache: {
      [connectionId]: {
        [SCHEMA_GRAPH_IMPACT_DB]: {
          [SCHEMA_GRAPH_IMPACT_SCHEMA]: {
            [SCHEMA_GRAPH_IMPACT_USER_TABLE]: [
              constraint("users_pkey", "PRIMARY KEY", ["id"]),
              constraint(SCHEMA_GRAPH_IMPACT_USER_EMAIL_CONSTRAINT, "UNIQUE", [
                "email",
              ]),
            ],
            [SCHEMA_GRAPH_IMPACT_SESSION_TABLE]: [
              constraint("sessions_pkey", "PRIMARY KEY", ["id"]),
              constraint(
                SCHEMA_GRAPH_IMPACT_SESSION_FK,
                "FOREIGN KEY",
                ["user_email"],
                {
                  reference_table: "public.users",
                  reference_columns: ["email"],
                },
              ),
            ],
          },
        },
      },
    },
  });
}

function table(name: string) {
  return { name, schema: SCHEMA_GRAPH_IMPACT_SCHEMA, row_count: null };
}

function column(
  name: string,
  overrides: Partial<{
    data_type: string;
    is_primary_key: boolean;
    is_foreign_key: boolean;
    fk_reference: string | null;
  }> = {},
) {
  return {
    name,
    data_type: "integer",
    nullable: false,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
    ...overrides,
  };
}

function index(
  name: string,
  columns: readonly string[],
  overrides: Partial<{ is_primary: boolean; is_unique: boolean }> = {},
) {
  return {
    name,
    columns: [...columns],
    index_type: "btree",
    is_primary: false,
    is_unique: false,
    ...overrides,
  };
}

function constraint(
  name: string,
  constraint_type: string,
  columns: readonly string[],
  overrides: Partial<{
    reference_table: string | null;
    reference_columns: string[] | null;
  }> = {},
) {
  return {
    name,
    constraint_type,
    columns: [...columns],
    reference_table: null,
    reference_columns: null,
    ...overrides,
  };
}
