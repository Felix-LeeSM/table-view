import type { StatementAnalysis } from "@/lib/sql/sqlSafety";

/**
 * MongoDB aggregate-pipeline danger analyzer. Returns the same
 * `StatementAnalysis` shape as RDB's `analyzeStatement` so
 * `useSafeModeGate` can run paradigm-agnostically.
 *
 * Destructive stages covered:
 * - `$out`   — replaces the target collection wholesale.
 * - `$merge` — upserts; can mutate rows the user didn't intend.
 *
 * `$function` server-side JS is out of scope — the danger boundary isn't
 * well-defined for it.
 *
 * On multiple violations, only the first stage's reason is surfaced;
 * resolving it lets the next violation re-block on the same path.
 *
 * Sprint 254 (2026-05-09) — read-only pipeline 은 `severity: "info"` (was
 * "safe"). 3-tier union split. ADR 0023 grill Q2-(a).
 *
 * Sprint 383 (2026-05-17) — depth-1 nested detect. `$facet` sub-pipelines
 * and `$lookup.pipeline` arrays are scanned for `$out`/`$merge` at one
 * extra level. Deeper nesting (`$facet > $facet > $out`) still slips
 * through; that needs a cycle detector tracked in a follow-up.
 */
export function analyzeMongoPipeline(pipeline: unknown[]): StatementAnalysis {
  for (const stage of pipeline) {
    if (!isPipelineStage(stage)) continue;
    const keys = Object.keys(stage);
    const op = keys[0];
    if (op === undefined) continue;
    if (op === "$out") return MONGO_OUT_DANGER;
    if (op === "$merge") return MONGO_MERGE_DANGER;
    // Sprint 383 — depth-1 nested scan for $facet / $lookup.pipeline.
    const nested = scanNestedDestructive(op, stage[op]);
    if (nested) return nested;
  }
  // Sprint 254 — read-only pipeline = INFO.
  return { kind: "mongo-other", severity: "info", reasons: [] };
}

const MONGO_OUT_DANGER: StatementAnalysis = {
  kind: "mongo-out",
  severity: "danger",
  reasons: ["MongoDB $out (collection replace)"],
};

const MONGO_MERGE_DANGER: StatementAnalysis = {
  kind: "mongo-merge",
  severity: "danger",
  reasons: ["MongoDB $merge (collection upsert)"],
};

// Sprint 383 — depth-1 nested detector. `$facet` carries a map of named
// sub-pipelines (`{alpha: [stages]}`); `$lookup` may carry a `pipeline`
// array. We only inspect immediate child stages — deeper nesting is a
// known follow-up.
function scanNestedDestructive(
  op: string | undefined,
  payload: unknown,
): StatementAnalysis | null {
  if (op === "$facet" && isPipelineStage(payload)) {
    for (const subPipeline of Object.values(payload)) {
      if (!Array.isArray(subPipeline)) continue;
      const found = scanTopLevelDestructive(subPipeline);
      if (found) return found;
    }
    return null;
  }
  if (op === "$lookup" && isPipelineStage(payload)) {
    const sub = payload["pipeline"];
    if (!Array.isArray(sub)) return null;
    return scanTopLevelDestructive(sub);
  }
  return null;
}

function scanTopLevelDestructive(
  pipeline: readonly unknown[],
): StatementAnalysis | null {
  for (const stage of pipeline) {
    if (!isPipelineStage(stage)) continue;
    const keys = Object.keys(stage);
    if (keys.length === 0) continue;
    const op = keys[0];
    if (op === "$out") return MONGO_OUT_DANGER;
    if (op === "$merge") return MONGO_MERGE_DANGER;
  }
  return null;
}

function isPipelineStage(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== null
  );
}

/**
 * MongoDB write-op safety classifier (the bulk-write parallel of
 * `analyzeMongoPipeline`). Returns the same `StatementAnalysis` shape
 * so `useSafeModeGate.decide` stays paradigm-agnostic.
 *
 * Sprint 254 (2026-05-09) — non-empty filter `*-many` 는 `severity: "warn"`
 * (was "safe"). 빈 filter `*-all` + dropCollection 은 `severity: "danger"`
 * 그대로.
 */
// Sprint 312 (Phase 28 Slice A6, 2026-05-14) — `MongoOperation` union
// widened to cover every mongosh write the parser-driven dispatch table
// emits. `insertOne` / `insertMany` / `updateOne` / `deleteOne` carry
// `severity: "info"` because each touches at most a single document —
// the user's intent + impact match. `bulkWrite` evaluates each sub-op
// against the same rule set so a hidden empty-filter `*-many` inside a
// batch still escalates the whole bulk to `"danger"`.
import type { BulkWriteOp } from "@/types/documentMutate";

export type MongoOperation =
  | { kind: "deleteMany"; filter: Record<string, unknown> }
  | {
      kind: "updateMany";
      filter: Record<string, unknown>;
      patch: Record<string, unknown>;
    }
  | { kind: "dropCollection" }
  | { kind: "insertOne" }
  | { kind: "insertMany"; count: number }
  | { kind: "updateOne"; filter: Record<string, unknown> }
  | { kind: "deleteOne"; filter: Record<string, unknown> }
  | { kind: "bulkWrite"; ops: readonly BulkWriteOp[] };

export function analyzeMongoOperation(op: MongoOperation): StatementAnalysis {
  if (op.kind === "dropCollection") {
    return {
      kind: "mongo-drop",
      severity: "danger",
      reasons: ["MongoDB dropCollection (whole collection)"],
    };
  }
  if (op.kind === "deleteMany") {
    if (isEmptyFilter(op.filter)) {
      return {
        kind: "mongo-delete-all",
        severity: "danger",
        reasons: ["MongoDB deleteMany without filter"],
      };
    }
    // Sprint 254 — bounded *-many = WARN tier.
    return { kind: "mongo-delete-many", severity: "warn", reasons: [] };
  }
  if (op.kind === "updateMany") {
    if (isEmptyFilter(op.filter)) {
      return {
        kind: "mongo-update-all",
        severity: "danger",
        reasons: ["MongoDB updateMany without filter"],
      };
    }
    // Sprint 254 — bounded *-many = WARN tier.
    return { kind: "mongo-update-many", severity: "warn", reasons: [] };
  }
  // Sprint 312 — single-document writes (`insertOne` / `insertMany` /
  // `updateOne` / `deleteOne`) are INFO. The user types the filter
  // explicitly; impact ≤ 1 doc per op so no warn-tier preview is needed.
  if (
    op.kind === "insertOne" ||
    op.kind === "insertMany" ||
    op.kind === "updateOne" ||
    op.kind === "deleteOne"
  ) {
    return { kind: "mongo-other", severity: "info", reasons: [] };
  }
  // bulkWrite — fan out and take the worst severity. Empty batch ⇒ INFO.
  return analyzeBulkWrite(op.ops);
}

function analyzeBulkWrite(ops: readonly BulkWriteOp[]): StatementAnalysis {
  let worst: StatementAnalysis = {
    kind: "mongo-other",
    severity: "info",
    reasons: [],
  };
  for (const sub of ops) {
    const subAnalysis = analyzeBulkSubOp(sub);
    if (severityRank(subAnalysis.severity) > severityRank(worst.severity)) {
      worst = subAnalysis;
    }
  }
  return worst;
}

function analyzeBulkSubOp(sub: BulkWriteOp): StatementAnalysis {
  switch (sub.op) {
    case "insertOne":
      return { kind: "mongo-other", severity: "info", reasons: [] };
    case "updateOne":
    case "deleteOne":
    case "replaceOne":
      return { kind: "mongo-other", severity: "info", reasons: [] };
    case "updateMany":
      return analyzeMongoOperation({
        kind: "updateMany",
        filter: sub.filter,
        patch: sub.update,
      });
    case "deleteMany":
      return analyzeMongoOperation({
        kind: "deleteMany",
        filter: sub.filter,
      });
  }
}

/**
 * Sprint 381/475 — `db.runCommand({...})` / `db.adminCommand({...})`
 * classifier. Only read-only command names are INFO; write-capable and
 * unknown command names are DANGER so the frontend passes an explicit
 * backend safety acknowledgment. `body` 의 first key 만 검사한다 — mongosh
 * runCommand convention 은 `{ <command>: <arg>, ...options }` 이므로 두
 * 번째 key 부터는 옵션이다.
 */
export const READ_ONLY_RUN_COMMAND_ALLOWLIST = [
  "buildInfo",
  "collStats",
  "connectionStatus",
  "count",
  "currentOp",
  "dbStats",
  "distinct",
  "explain",
  "find",
  "getCmdLineOpts",
  "getLog",
  "getParameter",
  "hello",
  "hostInfo",
  "isMaster",
  "listCollections",
  "listDatabases",
  "listIndexes",
  "ping",
  "serverStatus",
  "whatsmyuri",
] as const;

const READ_ONLY_RUN_COMMANDS: ReadonlySet<string> = new Set(
  READ_ONLY_RUN_COMMAND_ALLOWLIST,
);

export function analyzeMongoRunCommand(
  body: Record<string, unknown>,
): StatementAnalysis {
  const keys = Object.keys(body);
  if (keys.length === 0) {
    return { kind: "mongo-other", severity: "info", reasons: [] };
  }
  const command = keys[0]!;
  if (READ_ONLY_RUN_COMMANDS.has(command)) {
    return { kind: "mongo-other", severity: "info", reasons: [] };
  }
  return {
    kind: "mongo-drop",
    severity: "danger",
    reasons: [
      `MongoDB runCommand ${command} is not in the read-only allowlist`,
    ],
  };
}

function severityRank(severity: "info" | "warn" | "danger"): number {
  if (severity === "danger") return 2;
  if (severity === "warn") return 1;
  return 0;
}

function isEmptyFilter(filter: Record<string, unknown>): boolean {
  return Object.keys(filter).length === 0;
}

/**
 * Sprint 255 — Mongo paradigm 의 INFO tier 식별 휴리스틱. raw MQL editor 의
 * WARN dialog mount 분기에서 호출되어 read-only aggregate pipeline (find /
 * pure-read pipeline) 만 dialog skip → 직접 IPC 발동.
 *
 * Sprint 254 — `severity === "info"` 직접 비교로 단순화. 기존 매핑
 * (`mongo-other` + safe) 동일 의미 보존: read-only pipeline 만 severity:"info"
 * 로 분류된다.
 */
export function isInfoMongoOperation(analysis: StatementAnalysis): boolean {
  return analysis.severity === "info";
}
