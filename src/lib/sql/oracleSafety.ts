import { decideSafeModeAction, type SafeModeDecision } from "@/lib/safeMode";
import { stripSqlComments } from "./stripSqlComments";
import {
  analyzeStatement,
  type Severity,
  type StatementAnalysis,
  type StatementAnalysisOptions,
  type StatementKind,
} from "./sqlSafety";

export type OracleSafetySupport = "supported" | "unsupported";
export type OracleSafetySlice =
  | "select"
  | "dml"
  | "ddl"
  | "plsql"
  | "admin"
  | "unknown";

export interface OracleStatementAnalysis extends StatementAnalysis {
  readonly dialect: "oracle";
  readonly support: OracleSafetySupport;
  readonly slice: OracleSafetySlice;
  readonly boundaryReason: string | null;
}

export const ORACLE_SQL_SAFETY_BOUNDARY = Object.freeze({
  runtime: "static-parser-safe-mode-only",
  supported: Object.freeze({
    select: Object.freeze([
      "SELECT, including SELECT ... FROM DUAL and no-FROM projections",
      "WITH ... SELECT when the wrapped statement is read-only",
      "EXPLAIN/DESCRIBE metadata-style reads through the shared SQL boundary",
    ]),
    dml: Object.freeze([
      "INSERT INTO ... VALUES/SELECT/DEFAULT VALUES",
      "UPDATE ... WHERE as warn-tier bounded write",
      "DELETE ... WHERE as warn-tier bounded write",
      "WHERE-less UPDATE/DELETE as danger-tier destructive",
      "Narrow MERGE without DELETE action as warn-tier write",
    ]),
    ddl: Object.freeze([
      "CREATE TABLE/INDEX/VIEW as non-destructive construction",
      "Oracle CREATE TABLE scalar types NUMBER, VARCHAR2, CLOB, and BLOB",
      "ALTER TABLE ADD/RENAME as warn-tier schema change",
      "DROP/TRUNCATE/ALTER TABLE DROP as danger-tier destructive",
    ]),
    admin: Object.freeze([
      "GRANT/REVOKE as warn-tier permission change (issue #1120 parity — danger reserved for irreversible data destruction)",
    ]),
  }),
  unsupported: Object.freeze({
    plsql: Object.freeze([
      "DECLARE/BEGIN blocks",
      "CREATE PACKAGE/PACKAGE BODY/PROCEDURE/FUNCTION/TRIGGER/TYPE BODY",
      "EXEC/EXECUTE and EXECUTE IMMEDIATE paths",
      "CALL stored routine execution",
    ]),
    admin: Object.freeze([
      "ALTER SYSTEM/SESSION/DATABASE/USER/ROLE/TABLESPACE/PROFILE",
      "CREATE/DROP USER/ROLE/TABLESPACE/PROFILE/DATABASE LINK/DIRECTORY",
      "AUDIT/NOAUDIT/ANALYZE/FLASHBACK/PURGE",
    ]),
  }),
});

interface UnsupportedOraclePattern {
  readonly slice: Extract<OracleSafetySlice, "plsql" | "admin">;
  readonly kind: StatementKind;
  readonly severity: Severity;
  readonly reason: string;
  readonly pattern: RegExp;
}

const UNSUPPORTED_ORACLE_PATTERNS: readonly UnsupportedOraclePattern[] = [
  {
    slice: "plsql",
    kind: "routine-call",
    severity: "danger",
    reason: "Oracle PL/SQL block is outside the static safety boundary",
    pattern: /^(DECLARE|BEGIN)\b/,
  },
  {
    slice: "plsql",
    kind: "routine-call",
    severity: "danger",
    reason:
      "Oracle PL/SQL package/routine DDL is outside the static safety boundary",
    pattern:
      /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?(?:PACKAGE(?:\s+BODY)?|PROCEDURE|FUNCTION|TRIGGER|TYPE\s+BODY)\b/,
  },
  {
    slice: "plsql",
    kind: "routine-call",
    severity: "danger",
    reason:
      "Oracle EXEC/EXECUTE routine path is outside the static safety boundary",
    pattern: /^(EXEC|EXECUTE)\b/,
  },
  {
    slice: "plsql",
    kind: "routine-call",
    severity: "danger",
    reason:
      "CALL — stored routine execution is outside the Oracle static safety boundary",
    pattern: /^CALL\b/,
  },
  {
    slice: "admin",
    kind: "ddl-other",
    severity: "danger",
    reason:
      "Oracle ALTER admin statement is outside the static safety boundary",
    pattern:
      /^ALTER\s+(SYSTEM|SESSION|DATABASE|USER|ROLE|TABLESPACE|PROFILE|DISKGROUP|PLUGGABLE\s+DATABASE)\b/,
  },
  {
    slice: "admin",
    kind: "ddl-other",
    severity: "danger",
    reason:
      "Oracle CREATE admin statement is outside the static safety boundary",
    pattern:
      /^CREATE\s+(USER|ROLE|TABLESPACE|PROFILE|(?:PUBLIC\s+)?DATABASE\s+LINK|PLUGGABLE\s+DATABASE|DIRECTORY)\b/,
  },
  {
    slice: "admin",
    kind: "ddl-other",
    severity: "danger",
    reason: "Oracle DROP admin statement is outside the static safety boundary",
    pattern:
      /^DROP\s+(USER|ROLE|TABLESPACE|PROFILE|(?:PUBLIC\s+)?DATABASE\s+LINK|PLUGGABLE\s+DATABASE|DIRECTORY)\b/,
  },
  // Issue #1120 — GRANT/REVOKE dropped from this admin block so they fall
  // through to the shared `analyzeStatement` (permission-change / warn),
  // matching generic-SQL parity. AUDIT/NOAUDIT remain danger/block.
  {
    slice: "admin",
    kind: "ddl-other",
    severity: "danger",
    reason:
      "Oracle AUDIT/NOAUDIT statement is outside the static safety boundary",
    pattern: /^(AUDIT|NOAUDIT)\b/,
  },
  {
    slice: "admin",
    kind: "ddl-other",
    severity: "danger",
    reason:
      "Oracle maintenance/admin statement is outside the static safety boundary",
    pattern: /^(ANALYZE|FLASHBACK|PURGE)\b/,
  },
];

function normalizeOracleSql(sql: string): string {
  return stripSqlComments(sql).replace(/\s+/g, " ").trim().toUpperCase();
}

function isSupportedOracleCreate(normalized: string): boolean {
  return [
    /^CREATE\s+(?:GLOBAL\s+TEMPORARY\s+)?TABLE\b/,
    /^CREATE\s+(?:UNIQUE\s+|BITMAP\s+)?INDEX\b/,
    /^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b/,
  ].some((pattern) => pattern.test(normalized));
}

function supportedSlice(kind: StatementKind): OracleSafetySlice | null {
  if (kind === "select" || kind === "info" || kind === "config-read") {
    return "select";
  }
  if (
    kind === "dml-insert" ||
    kind === "dml-update" ||
    kind === "dml-delete" ||
    kind === "dml-merge"
  ) {
    return "dml";
  }
  if (
    kind === "ddl-create" ||
    kind === "ddl-alter-add" ||
    kind === "ddl-alter-rename" ||
    kind === "ddl-drop" ||
    kind === "ddl-truncate" ||
    kind === "ddl-alter-drop"
  ) {
    return "ddl";
  }
  // Issue #1120 — GRANT/REVOKE are warn-tier permission changes, supported
  // under the shared static boundary (parity with generic SQL).
  if (kind === "permission-change") {
    return "admin";
  }
  return null;
}

export function analyzeOracleStatement(sql: string): OracleStatementAnalysis {
  const normalized = normalizeOracleSql(sql);
  const unsupported = UNSUPPORTED_ORACLE_PATTERNS.find((entry) =>
    entry.pattern.test(normalized),
  );
  if (unsupported) {
    return {
      dialect: "oracle",
      support: "unsupported",
      slice: unsupported.slice,
      kind: unsupported.kind,
      severity: unsupported.severity,
      reasons: [unsupported.reason],
      boundaryReason: unsupported.reason,
    };
  }

  const analysis = analyzeStatement(sql);
  if (analysis.kind === "ddl-create" && !isSupportedOracleCreate(normalized)) {
    const reason = "Oracle CREATE statement is outside the bounded DDL slice";
    return {
      ...analysis,
      dialect: "oracle",
      support: "unsupported",
      slice: "ddl",
      severity: "danger",
      reasons: [reason],
      boundaryReason: reason,
    };
  }

  const slice = supportedSlice(analysis.kind);
  if (slice) {
    return {
      ...analysis,
      dialect: "oracle",
      support: "supported",
      slice,
      boundaryReason: null,
    };
  }

  const reason = "Oracle statement is outside the bounded static safety slice";
  return {
    ...analysis,
    dialect: "oracle",
    support: "unsupported",
    slice: "unknown",
    reasons: analysis.reasons.length > 0 ? analysis.reasons : [reason],
    boundaryReason: reason,
  };
}

export function decideOracleSafeModeAction(
  mode: "strict" | "warn" | "off",
  environment: string | null,
  analysis: OracleStatementAnalysis,
): SafeModeDecision {
  if (analysis.support === "unsupported") {
    return {
      action: "block",
      reason:
        analysis.boundaryReason ??
        "Oracle statement is outside the bounded static safety slice",
    };
  }

  return decideSafeModeAction(mode, environment, analysis);
}

export function analyzeRdbStatementForDialect(
  sql: string,
  dialect?: StatementAnalysisOptions["dialect"],
): StatementAnalysis {
  if (dialect === "oracle") return analyzeOracleStatement(sql);
  return analyzeStatement(sql, dialect ? { dialect } : undefined);
}

export function decideOracleOrGenericSafeMode(
  analysis: StatementAnalysis,
  decideSafeMode: (analysis: StatementAnalysis) => SafeModeDecision,
): SafeModeDecision {
  if (isOracleStatementAnalysis(analysis)) {
    return decideOracleSafeModeGate(analysis, decideSafeMode);
  }
  return decideSafeMode(analysis);
}

function isOracleStatementAnalysis(
  analysis: StatementAnalysis,
): analysis is OracleStatementAnalysis {
  return "dialect" in analysis && analysis.dialect === "oracle";
}

export function decideOracleSafeModeGate(
  analysis: OracleStatementAnalysis,
  decideSafeMode: (analysis: StatementAnalysis) => SafeModeDecision,
): SafeModeDecision {
  if (analysis.support === "unsupported") {
    return {
      action: "block",
      reason:
        analysis.boundaryReason ??
        "Oracle statement is outside the bounded static safety slice",
    };
  }

  return decideSafeMode(analysis);
}
