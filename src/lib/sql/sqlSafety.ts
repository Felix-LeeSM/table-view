export type Severity = "safe" | "danger";

export type StatementKind =
  | "select"
  | "insert"
  | "update"
  | "delete"
  | "ddl-drop"
  | "ddl-truncate"
  | "ddl-alter-drop"
  | "ddl-other"
  // Sprint 188 — Mongo aggregate-pipeline analyser shares this union so the
  // `useSafeModeGate` decision matrix is paradigm-agnostic. The mongo-*
  // variants only originate from `analyzeMongoPipeline`, never from
  // `analyzeStatement` (SQL).
  | "mongo-out"
  | "mongo-merge"
  | "mongo-other"
  // Sprint 198 — bulk-write operation analyser variants (`analyzeMongoOperation`).
  // `*-all` (empty filter) is danger; `*-many` (non-empty filter) is safe;
  // `mongo-drop` is unconditionally danger.
  | "mongo-drop"
  | "mongo-delete-all"
  | "mongo-delete-many"
  | "mongo-update-all"
  | "mongo-update-many"
  | "other";

export interface StatementAnalysis {
  kind: StatementKind;
  severity: Severity;
  reasons: string[];
}

const LINE_COMMENT_RE = /--[^\n\r]*/g;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const WHITESPACE_RE = /\s+/g;
const WORD_BOUNDARY_WHERE_RE = /\bWHERE\b/i;

function stripComments(sql: string): string {
  return sql.replace(BLOCK_COMMENT_RE, " ").replace(LINE_COMMENT_RE, " ");
}

function normalize(sql: string): string {
  return stripComments(sql).replace(WHITESPACE_RE, " ").trim();
}

function hasOuterWhere(stripped: string): boolean {
  return WORD_BOUNDARY_WHERE_RE.test(stripped);
}

export function analyzeStatement(sql: string): StatementAnalysis {
  const normalized = normalize(sql);
  if (normalized.length === 0) {
    return { kind: "other", severity: "safe", reasons: [] };
  }

  const upper = normalized.toUpperCase();

  if (/^DELETE\s+FROM\b/.test(upper)) {
    if (!hasOuterWhere(upper)) {
      return {
        kind: "delete",
        severity: "danger",
        reasons: ["DELETE without WHERE clause"],
      };
    }
    return { kind: "delete", severity: "safe", reasons: [] };
  }

  if (/^UPDATE\s+\S/.test(upper)) {
    if (!hasOuterWhere(upper)) {
      return {
        kind: "update",
        severity: "danger",
        reasons: ["UPDATE without WHERE clause"],
      };
    }
    return { kind: "update", severity: "safe", reasons: [] };
  }

  if (/^DROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW)\b/.test(upper)) {
    const match = upper.match(/^DROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW)\b/);
    const reason = match ? `DROP ${match[1]}` : "DROP";
    return { kind: "ddl-drop", severity: "danger", reasons: [reason] };
  }

  if (/^TRUNCATE\b/.test(upper)) {
    return { kind: "ddl-truncate", severity: "danger", reasons: ["TRUNCATE"] };
  }

  // Sprint 187 — `ALTER TABLE … DROP COLUMN/CONSTRAINT` is destructive enough
  // (column + data loss / FK invalidation) that the structure-surface gate
  // needs to flag it for the production warn / strict tier.
  if (/^ALTER\s+TABLE\b/.test(upper)) {
    const dropMatch = upper.match(/\bDROP\s+(COLUMN|CONSTRAINT)\b/);
    if (dropMatch) {
      return {
        kind: "ddl-alter-drop",
        severity: "danger",
        reasons: [`ALTER TABLE DROP ${dropMatch[1]}`],
      };
    }
  }

  if (
    /^DROP\b/.test(upper) ||
    /^ALTER\b/.test(upper) ||
    /^CREATE\b/.test(upper)
  ) {
    return { kind: "ddl-other", severity: "safe", reasons: [] };
  }

  if (/^INSERT\s+INTO\b/.test(upper)) {
    return { kind: "insert", severity: "safe", reasons: [] };
  }

  if (/^SELECT\b/.test(upper) || /^WITH\b/.test(upper)) {
    return { kind: "select", severity: "safe", reasons: [] };
  }

  return { kind: "other", severity: "safe", reasons: [] };
}

export function isDangerous(analysis: StatementAnalysis): boolean {
  return analysis.severity === "danger";
}
