// AC-192-03 / AC-192-05 — Sprint 192. RDB schema/database export hook.
//
// 통합 export 의 thin orchestrator — 3 가지 include 모드를 한 시그니처로
// 다룬다:
//   - "ddl"  : schema definition only (CREATE TABLE / INDEX / FK)
//   - "dml"  : data only (INSERT … VALUES)
//   - "both" : DDL + data (full dump)
//
// 단위:
//   - `exportSchema(connId, schema, include)`     : single schema
//   - `exportDatabase(connId, schemas[], include)`: all schemas of a connection
//
// DDL 합성은 lib pure (`generateMigrationDDL`) — TS 가 schemaStore 의
// metadata 로 합성. DML row stream 은 Rust (`export_schema_dump`) 가
// PG cursor + INSERT formatting 으로 처리. 본 hook 은:
//   1. connection → dialect 매핑 (RDB only)
//   2. schemaStore 에서 metadata 수집 (cache miss 시 force load)
//   3. include 에 따라 invoke 분기:
//      - "ddl"  → generateMigrationDDL → writeTextFileExport
//      - "dml"  → exportSchemaDump (ddl_header="")
//      - "both" → generateMigrationDDL → exportSchemaDump (ddl_header=DDL)
//   4. save() dialog → silent return on cancel
//   5. toast success/failure
//
// MySQL/SQLite adapter 는 Phase 9 placeholder 이므로 현재 실제 동작은
// PostgreSQL only — backend 의 `RdbAdapter::stream_table_rows` default
// 가 `Unsupported` 라 자동 reject 된다.
//
// date 2026-05-02.
import { useCallback, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
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
import { toast } from "@/lib/toast";

export type ExportInclude = "ddl" | "dml" | "both";

export interface UseMigrationExportReturn {
  exportSchema: (
    connectionId: string,
    schema: string,
    include: ExportInclude,
  ) => Promise<void>;
  exportDatabase: (
    connectionId: string,
    schemas: string[],
    include: ExportInclude,
  ) => Promise<void>;
  isExporting: boolean;
}

const DBMS_TO_DIALECT: Partial<Record<string, DdlDialect>> = {
  postgresql: "postgresql",
  mysql: "mysql",
  sqlite: "sqlite",
};

const INCLUDE_LABEL: Record<ExportInclude, string> = {
  ddl: "Schema (DDL)",
  dml: "Data (INSERT)",
  both: "Full dump (DDL + data)",
};

const STREAM_BATCH_SIZE = 1000;

interface SchemaMeta {
  schema: string;
  ddlTables: DdlExportTable[];
}

async function loadSchemaMetadata(
  connectionId: string,
  schema: string,
): Promise<DdlExportTable[]> {
  const store = useSchemaStore.getState();
  const cacheKey = `${connectionId}:${schema}`;
  let tables = store.tables[cacheKey];
  if (!tables) {
    await store.loadTables(connectionId, schema);
    tables = useSchemaStore.getState().tables[cacheKey] ?? [];
  }
  return Promise.all(
    tables.map(async (t): Promise<DdlExportTable> => {
      const [columns, indexes, constraints] = await Promise.all([
        store.getTableColumns(connectionId, t.name, schema),
        store.getTableIndexes(connectionId, t.name, schema),
        store.getTableConstraints(connectionId, t.name, schema),
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
      toast.error("Export: connection not found");
      return null;
    }
    const dialect = DBMS_TO_DIALECT[conn.db_type];
    if (!dialect) {
      toast.error(`Export: ${conn.db_type} is not yet supported (RDB only)`);
      return null;
    }
    return { dialect, dbType: conn.db_type };
  };

  const exportSchema = useCallback(
    async (connectionId: string, schema: string, include: ExportInclude) => {
      if (isExporting) return;
      const resolved = resolveDialect(connectionId);
      if (!resolved) return;

      setIsExporting(true);
      try {
        const ddlTables = await loadSchemaMetadata(connectionId, schema);
        if (ddlTables.length === 0) {
          toast.info(`Export: schema "${schema}" has no tables`);
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
            `Exported ${INCLUDE_LABEL.ddl} (${ddlTables.length} table${ddlTables.length === 1 ? "" : "s"}, ${formatKb(summary.bytes_written)} KB)`,
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
          { include, batchSize: STREAM_BATCH_SIZE },
        );
        toast.success(
          `Exported ${INCLUDE_LABEL[include]} (${formatRows(summary.rows_written)} row${summary.rows_written === 1 ? "" : "s"}, ${formatKb(summary.bytes_written)} KB)`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Export failed: ${message}`);
      } finally {
        setIsExporting(false);
      }
    },
    [isExporting],
  );

  const exportDatabase = useCallback(
    async (connectionId: string, schemas: string[], include: ExportInclude) => {
      if (isExporting) return;
      if (schemas.length === 0) {
        toast.info("Export: no schemas to export");
        return;
      }
      const resolved = resolveDialect(connectionId);
      if (!resolved) return;

      setIsExporting(true);
      try {
        const metas: SchemaMeta[] = await Promise.all(
          schemas.map(async (schema) => ({
            schema,
            ddlTables: await loadSchemaMetadata(connectionId, schema),
          })),
        );
        const totalTables = metas.reduce(
          (sum, m) => sum + m.ddlTables.length,
          0,
        );
        if (totalTables === 0) {
          toast.info("Export: database has no tables");
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
            `Exported ${INCLUDE_LABEL.ddl} (${metas.length} schema${metas.length === 1 ? "" : "s"}, ${totalTables} table${totalTables === 1 ? "" : "s"}, ${formatKb(summary.bytes_written)} KB)`,
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
          { include, batchSize: STREAM_BATCH_SIZE },
        );
        toast.success(
          `Exported ${INCLUDE_LABEL[include]} (${metas.length} schema${metas.length === 1 ? "" : "s"}, ${formatRows(summary.rows_written)} row${summary.rows_written === 1 ? "" : "s"}, ${formatKb(summary.bytes_written)} KB)`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Export failed: ${message}`);
      } finally {
        setIsExporting(false);
      }
    },
    [isExporting],
  );

  return { exportSchema, exportDatabase, isExporting };
}
