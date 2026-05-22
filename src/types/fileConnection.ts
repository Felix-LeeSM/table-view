export type FileConnectionPermissionScope = "local-file";
export type FileConnectionPrivacyPolicyId = "local-first";
export type FileConnectionInputKind = "database" | "analytics";
export type FileConnectionInputStatus = "supported" | "deferred";

export interface FileConnectionInputContract {
  readonly id: string;
  readonly kind: FileConnectionInputKind;
  readonly extensions: readonly string[];
  readonly status: FileConnectionInputStatus;
}

export interface FileConnectionContract {
  readonly pathField: "database";
  readonly readOnlyField: "readOnly";
  readonly permissionScope: FileConnectionPermissionScope;
  readonly privacyPolicy: FileConnectionPrivacyPolicyId;
  readonly supportedInputs: readonly FileConnectionInputContract[];
  readonly deferredInputs: readonly FileConnectionInputContract[];
}

function fileInput(
  id: string,
  kind: FileConnectionInputKind,
  extensions: readonly string[],
  status: FileConnectionInputStatus,
): FileConnectionInputContract {
  return Object.freeze({
    id,
    kind,
    extensions: Object.freeze([...extensions]),
    status,
  });
}

function fileConnectionContract(
  supportedInputs: readonly FileConnectionInputContract[],
  deferredInputs: readonly FileConnectionInputContract[] = [],
): FileConnectionContract {
  return Object.freeze({
    pathField: "database",
    readOnlyField: "readOnly",
    permissionScope: "local-file",
    privacyPolicy: "local-first",
    supportedInputs: Object.freeze([...supportedInputs]),
    deferredInputs: Object.freeze([...deferredInputs]),
  });
}

export const SQLITE_FILE_CONNECTION = fileConnectionContract([
  fileInput(
    "sqlite-database",
    "database",
    [".sqlite", ".sqlite3", ".db"],
    "supported",
  ),
]);

export const DUCKDB_FILE_CONNECTION = fileConnectionContract(
  [fileInput("duckdb-database", "database", [".duckdb"], "supported")],
  [
    fileInput("csv", "analytics", [".csv"], "deferred"),
    fileInput("parquet", "analytics", [".parquet"], "deferred"),
    fileInput("json", "analytics", [".json", ".ndjson"], "deferred"),
  ],
);
