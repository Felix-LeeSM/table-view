export interface SchemaInfo {
  name: string;
}

export interface TableInfo {
  name: string;
  schema: string;
  row_count: number | null;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  fk_reference: string | null;
}

export interface TableData {
  columns: ColumnInfo[];
  rows: unknown[][];
  total_count: number;
  page: number;
  page_size: number;
}
