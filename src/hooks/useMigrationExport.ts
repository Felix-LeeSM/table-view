// RDB schema/database export hook. Thin orchestrator over three include
// modes:
//   - "ddl"  : schema definition only (CREATE TABLE / INDEX / FK)
//   - "dml"  : data only (INSERT … VALUES)
//   - "both" : DDL + data
//
// `exportSchema` operates on a single schema; `exportDatabase` loops
// over every schema in a connection.
//
// DDL synthesis lives in the pure `generateMigrationDDL`; DML row
// streaming runs in Rust (`export_schema_dump`). Both are dialect-aware:
// the resolved dialect shapes the DDL and is forwarded to the backend so
// the DML INSERTs use the matching identifier/string quoting (#1641 —
// MySQL/MariaDB backtick + backslash escape; #1642 — MSSQL `[bracket]` +
// T-SQL escape; #1674 — Oracle `"double-quote"` + Oracle value escape;
// PG/SQLite ANSI). This hook handles connection→dialect mapping, schemaStore
// metadata gathering, the invoke branch, the save() dialog (silent on cancel),
// and toasts.
//
// Data path (`RdbAdapter::stream_table_rows`) is implemented for PostgreSQL
// (postgres.rs), MySQL/MariaDB (mysql.rs, shared adapter), SQLite
// (adapters/sqlite, #1068), MSSQL (mssql/runtime.rs, #1642), and Oracle
// (oracle/runtime.rs, #1674). Every other engine — DuckDB — rejects DML/Full
// dumps as `Unsupported`, so callers gate the export UI via
// `supportsMigrationExport`.
import { useCallback, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { DatabaseName, SchemaName, TableName } from "@/types/branded";
import {
  generateMigrationDDL,
  buildSequenceResets,
  type DdlDialect,
  type DdlExportTable,
} from "@/lib/sql/ddlGenerator";
import {
  writeTextFileExport,
  exportSchemaDump,
  type SchemaDumpTable,
} from "@/lib/tauri";
import { toast } from "@/lib/runtime/toast";
import i18n from "@lib/i18n";

export type ExportInclude = "ddl" | "dml" | "both";

export interface UseMigrationExportReturn {
  exportSchema: (
    connectionId: string,
    database: string,
    schema: string,
    include: ExportInclude,
  ) => Promise<void>;
  exportDatabase: (
    connectionId: string,
    database: string,
    schemas: string[],
    include: ExportInclude,
  ) => Promise<void>;
  // Sprint 301 — 단일 table export. SchemaTree row 의 컨텍스트 메뉴
  // 진입점에서 호출. include 시맨틱 / Unsupported driver 의 toast 정책은
  // `exportSchema` 와 동일.
  exportTable: (
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    include: ExportInclude,
  ) => Promise<void>;
  isExporting: boolean;
}

const DBMS_TO_DIALECT: Partial<Record<string, DdlDialect>> = {
  postgresql: "postgresql",
  mysql: "mysql",
  mariadb: "mariadb",
  sqlite: "sqlite",
  mssql: "mssql",
  oracle: "oracle",
};

// Engines whose `stream_table_rows` backend is implemented (postgres.rs /
// mysql.rs; MariaDB shares the MySQL adapter; sqlite adapter, #1068; mssql
// runtime.rs, #1642; oracle runtime.rs, #1674). Any other engine rejects
// DML/Full dumps as `Unsupported`, so the schema-tree export controls (header
// popover + row context menus) surface only for these — surfacing elsewhere
// would be an error-on-click (#1048).
const MIGRATION_EXPORT_DBTYPES = new Set([
  "postgresql",
  "mysql",
  "mariadb",
  "sqlite",
  "mssql",
  "oracle",
]);

export function supportsMigrationExport(dbType: string | undefined): boolean {
  return dbType !== undefined && MIGRATION_EXPORT_DBTYPES.has(dbType);
}

const includeLabel = (include: ExportInclude): string =>
  i18n.t(`export:includeLabel.${include}`);

const STREAM_BATCH_SIZE = 1000;

interface SchemaMeta {
  schema: string;
  ddlTables: DdlExportTable[];
}

async function loadSchemaMetadata(
  connectionId: string,
  database: string,
  schema: string,
): Promise<DdlExportTable[]> {
  const store = useSchemaStore.getState();
  let tables = store.tables[connectionId]?.[database]?.[schema];
  if (!tables) {
    await store.loadTables(connectionId, database, schema);
    tables =
      useSchemaStore.getState().tables[connectionId]?.[database]?.[schema] ??
      [];
  }
  return Promise.all(
    tables.map(async (t): Promise<DdlExportTable> => {
      const [columns, indexes, constraints] = await Promise.all([
        store.getTableColumns(
          connectionId,
          database as DatabaseName,
          schema as SchemaName,
          t.name as TableName,
        ),
        store.getTableIndexes(
          connectionId,
          database as DatabaseName,
          schema as SchemaName,
          t.name as TableName,
        ),
        store.getTableConstraints(
          connectionId,
          database as DatabaseName,
          schema as SchemaName,
          t.name as TableName,
        ),
      ]);
      return { name: t.name, columns, indexes, constraints };
    }),
  );
}

function toDumpTables(metas: SchemaMeta[]): SchemaDumpTable[] {
  return metas.flatMap(({ schema, ddlTables }) =>
    ddlTables
      .filter((t) => t.columns.length > 0)
      .map((t) => ({
        schema,
        table: t.name,
        columnNames: t.columns.map((c) => c.name),
        // #1677 — carry each column's category (same order/source as the names)
        // so the backend dumps binary/BLOB cells as an unquoted binary literal.
        // `category` is backend-optional; a missing one is `unknown` (non-binary).
        columnCategories: t.columns.map((c) => c.category ?? "unknown"),
      })),
  );
}

function formatRows(n: number): string {
  return n.toLocaleString();
}

function formatKb(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

export function useMigrationExport(): UseMigrationExportReturn {
  const [isExporting, setIsExporting] = useState(false);

  const resolveDialect = (
    connectionId: string,
  ): { dialect: DdlDialect; dbType: string } | null => {
    const conn = useConnectionStore
      .getState()
      .connections.find((c) => c.id === connectionId);
    if (!conn) {
      toast.error(i18n.t("export:connectionNotFound"));
      return null;
    }
    const dialect = DBMS_TO_DIALECT[conn.dbType];
    if (!dialect) {
      toast.error(i18n.t("export:unsupportedDbType", { dbType: conn.dbType }));
      return null;
    }
    return { dialect, dbType: conn.dbType };
  };

  const exportSchema = useCallback(
    async (
      connectionId: string,
      database: string,
      schema: string,
      include: ExportInclude,
    ) => {
      if (isExporting) return;
      const resolved = resolveDialect(connectionId);
      if (!resolved) return;

      setIsExporting(true);
      try {
        const ddlTables = await loadSchemaMetadata(
          connectionId,
          database,
          schema,
        );
        if (ddlTables.length === 0) {
          toast.info(i18n.t("export:schemaNoTables", { schema }));
          return;
        }

        const ddlHeader =
          include === "ddl" || include === "both"
            ? generateMigrationDDL({
                dialect: resolved.dialect,
                schema,
                tables: ddlTables,
              })
            : "";

        const suffix =
          include === "ddl"
            ? "schema.sql"
            : include === "dml"
              ? "data.sql"
              : "dump.sql";
        const target = await save({
          defaultPath: `${schema}.${suffix}`,
          filters: [{ name: "SQL", extensions: ["sql"] }],
        });
        if (target === null || target === undefined) return;

        if (include === "ddl") {
          const summary = await writeTextFileExport(target, ddlHeader);
          toast.success(
            i18n.t("export:exported", {
              label: includeLabel("ddl"),
              detail: `${ddlTables.length} table${ddlTables.length === 1 ? "" : "s"}, ${formatKb(summary.bytes_written)} KB`,
            }),
          );
          return;
        }

        const dumpTables = toDumpTables([{ schema, ddlTables }]);
        // BIGSERIAL/SERIAL 정규화로 column DDL 에 sequence 가 자동 emit
        // 되지만 row 가 INSERT 된 후 next value 가 1 로 머무는 문제는
        // 별도 setval 줄로 reset.
        const ddlFooter = buildSequenceResets(
          resolved.dialect,
          schema,
          ddlTables,
        ).join("\n");
        const summary = await exportSchemaDump(
          connectionId,
          target,
          ddlHeader,
          ddlFooter,
          dumpTables,
          { include, batchSize: STREAM_BATCH_SIZE, dialect: resolved.dialect },
        );
        toast.success(
          i18n.t("export:exported", {
            label: includeLabel(include),
            detail: `${formatRows(summary.rows_written)} row${summary.rows_written === 1 ? "" : "s"}, ${formatKb(summary.bytes_written)} KB`,
          }),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(i18n.t("export:failed", { message }));
      } finally {
        setIsExporting(false);
      }
    },
    [isExporting],
  );

  const exportDatabase = useCallback(
    async (
      connectionId: string,
      database: string,
      schemas: string[],
      include: ExportInclude,
    ) => {
      if (isExporting) return;
      if (schemas.length === 0) {
        toast.info(i18n.t("export:noSchemas"));
        return;
      }
      const resolved = resolveDialect(connectionId);
      if (!resolved) return;

      setIsExporting(true);
      try {
        const metas: SchemaMeta[] = await Promise.all(
          schemas.map(async (schema) => ({
            schema,
            ddlTables: await loadSchemaMetadata(connectionId, database, schema),
          })),
        );
        const totalTables = metas.reduce(
          (sum, m) => sum + m.ddlTables.length,
          0,
        );
        if (totalTables === 0) {
          toast.info(i18n.t("export:databaseNoTables"));
          return;
        }

        const ddlHeader =
          include === "ddl" || include === "both"
            ? metas
                .map(({ schema, ddlTables }) =>
                  generateMigrationDDL({
                    dialect: resolved.dialect,
                    schema,
                    tables: ddlTables,
                  }),
                )
                .join("\n\n")
            : "";

        const suffix =
          include === "ddl"
            ? "schema.sql"
            : include === "dml"
              ? "data.sql"
              : "dump.sql";
        const target = await save({
          defaultPath: `database.${suffix}`,
          filters: [{ name: "SQL", extensions: ["sql"] }],
        });
        if (target === null || target === undefined) return;

        if (include === "ddl") {
          const summary = await writeTextFileExport(target, ddlHeader);
          toast.success(
            i18n.t("export:exported", {
              label: includeLabel("ddl"),
              detail: `${metas.length} schema${metas.length === 1 ? "" : "s"}, ${totalTables} table${totalTables === 1 ? "" : "s"}, ${formatKb(summary.bytes_written)} KB`,
            }),
          );
          return;
        }

        const dumpTables = toDumpTables(metas);
        const ddlFooter = metas
          .flatMap(({ schema, ddlTables }) =>
            buildSequenceResets(resolved.dialect, schema, ddlTables),
          )
          .join("\n");
        const summary = await exportSchemaDump(
          connectionId,
          target,
          ddlHeader,
          ddlFooter,
          dumpTables,
          { include, batchSize: STREAM_BATCH_SIZE, dialect: resolved.dialect },
        );
        toast.success(
          i18n.t("export:exported", {
            label: includeLabel(include),
            detail: `${metas.length} schema${metas.length === 1 ? "" : "s"}, ${formatRows(summary.rows_written)} row${summary.rows_written === 1 ? "" : "s"}, ${formatKb(summary.bytes_written)} KB`,
          }),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(i18n.t("export:failed", { message }));
      } finally {
        setIsExporting(false);
      }
    },
    [isExporting],
  );

  const exportTable = useCallback(
    async (
      connectionId: string,
      database: string,
      schema: string,
      table: string,
      include: ExportInclude,
    ) => {
      if (isExporting) return;
      const resolved = resolveDialect(connectionId);
      if (!resolved) return;

      setIsExporting(true);
      try {
        const allTables = await loadSchemaMetadata(
          connectionId,
          database,
          schema,
        );
        const target = allTables.find((t) => t.name === table);
        if (!target) {
          toast.error(
            i18n.t("export:tableMetadataNotFound", { schema, table }),
          );
          return;
        }

        const ddlHeader =
          include === "ddl" || include === "both"
            ? generateMigrationDDL({
                dialect: resolved.dialect,
                schema,
                tables: [target],
              })
            : "";

        const suffix =
          include === "ddl"
            ? "schema.sql"
            : include === "dml"
              ? "data.sql"
              : "dump.sql";
        const savePath = await save({
          defaultPath: `${schema}.${table}.${suffix}`,
          filters: [{ name: "SQL", extensions: ["sql"] }],
        });
        if (savePath === null || savePath === undefined) return;

        if (include === "ddl") {
          const summary = await writeTextFileExport(savePath, ddlHeader);
          toast.success(
            i18n.t("export:exported", {
              label: includeLabel("ddl"),
              detail: `${schema}.${table}, ${formatKb(summary.bytes_written)} KB`,
            }),
          );
          return;
        }

        const dumpTables = toDumpTables([{ schema, ddlTables: [target] }]);
        const ddlFooter = buildSequenceResets(resolved.dialect, schema, [
          target,
        ]).join("\n");
        const summary = await exportSchemaDump(
          connectionId,
          savePath,
          ddlHeader,
          ddlFooter,
          dumpTables,
          { include, batchSize: STREAM_BATCH_SIZE, dialect: resolved.dialect },
        );
        toast.success(
          i18n.t("export:exported", {
            label: includeLabel(include),
            detail: `${schema}.${table}, ${formatRows(summary.rows_written)} row${summary.rows_written === 1 ? "" : "s"}, ${formatKb(summary.bytes_written)} KB`,
          }),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(i18n.t("export:failed", { message }));
      } finally {
        setIsExporting(false);
      }
    },
    [isExporting],
  );

  return { exportSchema, exportDatabase, exportTable, isExporting };
}
