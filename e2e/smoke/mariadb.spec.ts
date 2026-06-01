import { createMariaDbConnection } from "./_helpers";
import { defineMysqlFamilySmoke } from "./mysql-family-baseline";

defineMysqlFamilySmoke({
  dbLabel: "MariaDB",
  connectionName: "E2E MariaDB",
  database: process.env.MARIADB_DATABASE ?? "table_view_test",
  retryAlias: "retry_after_mariadb_cancel",
  createConnection: createMariaDbConnection,
});
