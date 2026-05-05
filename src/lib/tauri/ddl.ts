import { invoke } from "@tauri-apps/api/core";
import type {
  AddConstraintRequest,
  AlterTableRequest,
  CreateIndexRequest,
  DropIndexRequest,
  DropConstraintRequest,
  SchemaChangeResult,
} from "@/types/schema";

// Table management
export async function dropTable(
  connectionId: string,
  table: string,
  schema: string,
): Promise<void> {
  return invoke("drop_table", { connectionId, table, schema });
}

export async function renameTable(
  connectionId: string,
  table: string,
  schema: string,
  newName: string,
): Promise<void> {
  return invoke("rename_table", { connectionId, table, schema, newName });
}

// Schema change operations
export async function alterTable(
  request: AlterTableRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("alter_table", { request });
}

export async function createIndex(
  request: CreateIndexRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("create_index", { request });
}

export async function dropIndex(
  request: DropIndexRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("drop_index", { request });
}

export async function addConstraint(
  request: AddConstraintRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("add_constraint", { request });
}

export async function dropConstraint(
  request: DropConstraintRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("drop_constraint", { request });
}
