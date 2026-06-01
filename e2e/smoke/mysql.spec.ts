import { createMysqlConnection } from "./_helpers";
import { defineMysqlFamilySmoke } from "./mysql-family-baseline";

defineMysqlFamilySmoke({
  dbLabel: "MySQL",
  connectionName: "E2E MySQL",
  database: process.env.MYSQL_DATABASE ?? "table_view_test",
  retryAlias: "retry_after_mysql_cancel",
  createConnection: createMysqlConnection,
});
