export type Severity = "safe" | "danger";

export type StatementKind =
  | "select"
  // Sprint 255 — `info` 는 SELECT 외 read-only / metadata 조회 (EXPLAIN /
  // SHOW / DESCRIBE / DESC) 의 분류. `select` 와 같은 INFO tier 지만 식별
  // helper (`isInfoStatement`) 에서 함께 true 로 처리된다. Mongo INFO 는
  // 별도 helper (`isInfoMongoOperation`) 가 read-only pipeline 을 식별.
  | "info"
  | "insert"
  | "update"
  | "delete"
  | "ddl-drop"
  | "ddl-truncate"
  | "ddl-alter-drop"
  | "ddl-other"
  // Mongo variants share this union so `useSafeModeGate` is
  // paradigm-agnostic. They originate from `analyzeMongoPipeline` /
  // `analyzeMongoOperation`, never from `analyzeStatement` (SQL).
  // `*-all` (empty filter) is danger; `*-many` (non-empty filter) is safe;
  // `mongo-drop` is unconditionally danger.
  | "mongo-out"
  | "mongo-merge"
  | "mongo-other"
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

  // `ALTER TABLE … DROP COLUMN/CONSTRAINT` is destructive enough
  // (column + data loss / FK invalidation) that the structure-surface
  // gate must flag it for the production warn / strict tier.
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

  // Sprint 255 — read-only / metadata introspection 의 INFO tier. EXPLAIN /
  // SHOW / DESCRIBE / DESC 모두 backend 에 commit 영향이 없으므로 raw editor
  // 의 WARN dialog 를 skip 하고 직접 IPC 발동한다. `kind: "info"` 는 신규
  // 분류 — 기존 `select` / `ddl-other` 분기 회귀 0 (위 분기에서 매칭되지
  // 않은 statement 만 여기 도달). 다른 paradigm 의 introspection 명령
  // (Mongo `db.runCommand("explain")`) 은 `mongoSafety` 의
  // `isInfoMongoOperation` 가 별도로 처리.
  if (/^(EXPLAIN|SHOW|DESCRIBE|DESC)\b/.test(upper)) {
    return { kind: "info", severity: "safe", reasons: [] };
  }

  return { kind: "other", severity: "safe", reasons: [] };
}

export function isDangerous(analysis: StatementAnalysis): boolean {
  return analysis.severity === "danger";
}

/**
 * Sprint 255 — INFO tier 식별 휴리스틱. raw SQL editor 의 WARN dialog mount
 * 분기에서 호출되어 `severity: "safe"` 인 statement 중 read-only /
 * metadata-introspection 만 dialog skip → 직접 IPC 발동.
 *
 * INFO = `kind === "select"` (SELECT / WITH …SELECT no DML CTE; analyzer 가
 * 이미 그렇게 분류) || `kind === "info"` (EXPLAIN / SHOW / DESCRIBE / DESC).
 * 그 외 safe (INSERT / UPDATE WHERE / DELETE WHERE / CREATE / ALTER additive)
 * 는 WARN tier — `false` 반환.
 *
 * `severity: "danger"` (STOP) 는 INFO 가 아니므로 false.
 */
export function isInfoStatement(analysis: StatementAnalysis): boolean {
  return analysis.kind === "select" || analysis.kind === "info";
}
