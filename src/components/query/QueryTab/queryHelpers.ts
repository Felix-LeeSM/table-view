import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import {
  extractDbMutation,
  type SqlMutationDialect,
} from "@lib/sql/sqlDialectMutations";
import { verifyActiveDb } from "@lib/api/verifyActiveDb";
import { toast } from "@lib/toast";
import type { Paradigm } from "@/types/connection";
import type { QueryTab } from "@stores/tabStore";

/**
 * `QueryTab` 의 모듈-top pure helpers + Sprint 132 raw-query DB-change
 * detection hook.
 *
 * 책임:
 *   - `DocumentQueryContext` + `readDocumentContext` — document-paradigm
 *     tab 의 database/collection 읽기. Mongo find/aggregate Tauri 명령
 *     이 두 필드 없이는 실패하므로 명시적 null check.
 *   - `isRecord` / `isRecordArray` — JSON.parse 결과의 타입 좁히기. find
 *     body 는 object, aggregate pipeline 은 object[] 강제.
 *   - `applyDbMutationHint` — SQL 실행 후 `\c` / `USE` / `SET search_path`
 *     같은 DB-mutation 을 lex 해 optimistic active-DB 갱신 + verify
 *     round-trip. fire-and-forget — 어떤 실패도 query 결과 패널에
 *     영향 안 줌 ("verify 실패 ≠ query 실패").
 *
 * Sprint 201 에서 entry 의 모듈-top 영역에서 추출. catch {} 2곳
 * (verify-best-effort + outer guard) 그대로 보존 — Sprint 206 후보.
 *
 * 외부 invariant:
 * - `applyDbMutationHint` 는 절대 throw 하지 않음. 호출자는 fire-and-forget
 *   (`void` prefix) 로 호출. Sprint 132 contract.
 * - rdb 외 paradigm 은 즉시 short-circuit. 현재 구현은 PG dialect
 *   하드코딩 — MySQL 어댑터 sprint 에서 `tab.connectionMeta.databaseType`
 *   기반 dialect 결정으로 확장 예정.
 */

export interface DocumentQueryContext {
  database: string;
  collection: string;
}

export function readDocumentContext(
  tab: QueryTab,
): DocumentQueryContext | null {
  if (!tab.database || !tab.collection) return null;
  return { database: tab.database, collection: tab.collection };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRecordArray(
  value: unknown,
): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

// ─── Sprint 132 — raw-query DB-change detection hook ──────────────────────
// After `await executeQuery(...)` we re-scan the SQL the user just ran for
// dialect-specific DB / schema / Redis-index switch patterns. A match
// triggers an *optimistic* `setActiveDb(targetDb)` so the toolbar / sidebar
// reflect the new context without a manual click, followed by a backend
// `verify_active_db` round-trip. A verify-mismatch surfaces a `toast.warn`
// and reverts the optimistic value to whatever the backend actually sees.
//
// `applyDbMutationHint` is intentionally fire-and-forget from the caller's
// perspective: it never throws — verify failures are swallowed with a
// console-free best-effort recovery so the query result panel stays
// rendered even when the network bounced.
//
// Document-paradigm tabs short-circuit immediately — Mongo doesn't use the
// SQL-style `\c` / `USE` syntax. Search/Kv paradigms aren't routed through
// `executeQuery` so they never reach this helper.
export async function applyDbMutationHint(
  connectionId: string,
  paradigm: Paradigm,
  sql: string,
  setActiveDb: (id: string, dbName: string) => void,
  clearForConnection: (id: string) => void,
): Promise<void> {
  if (paradigm !== "rdb") return;
  // Sprint 132 only ships Postgres. MySQL/Redis dialects fall through here
  // (the lexer accepts them) but the QueryTab UI today only routes PG raw
  // SQL, so the dialect map is hard-coded. A future MySQL adapter sprint
  // will resolve dialect from `tab.connectionMeta.databaseType`.
  const dialect: SqlMutationDialect = "postgres";
  const hint = extractDbMutation(sql, dialect);
  if (!hint) return;

  try {
    if (hint.kind === "switch_database") {
      // Optimistic local update — toolbar trigger label and any reader of
      // `activeStatuses[id].activeDb` flips immediately.
      setActiveDb(connectionId, hint.targetDb);
      // Schema cache must be evicted before any sidebar refresh request
      // can race in with the old DB's tables.
      clearForConnection(connectionId);
      try {
        const actual = await verifyActiveDb(connectionId);
        // Empty string === "could not verify" (Mongo-side semantic borrowed
        // for symmetry); skip the mismatch toast.
        if (actual && actual !== hint.targetDb) {
          toast.warning(
            `Active DB mismatch: expected '${hint.targetDb}', got '${actual}'. Reverting.`,
          );
          setActiveDb(connectionId, actual);
        }
      } catch {
        // Verify-best-effort. The query result must remain visible even
        // when verify fails (network blip, backend restart) — sprint 132
        // contract: "verify 실패 ≠ query 실패".
      }
    } else if (hint.kind === "switch_schema") {
      // Schema-level change — there's no cheap PG accessor to verify, so
      // we just evict the schema cache and surface an info toast.
      clearForConnection(connectionId);
      toast.info(`Active schema set to '${hint.targetSchema}'.`);
    } else if (hint.kind === "redis_select") {
      // Phase 9 Redis adapter will wire DB-index switching. For sprint 132
      // we only acknowledge the user's intent.
      toast.info(`Redis SELECT ${hint.databaseIndex} acknowledged.`);
    }
  } catch {
    // Outer guard — the hook must never propagate to the user. Any
    // exception thrown by the store mutators or the extractor is treated
    // as a no-op.
  }
}

/**
 * Helper to dispatch `applyDbMutationHint` with the current store snapshot.
 * Single call site previously inlined twice in `handleExecute`; lifting it
 * here keeps the snapshot read pattern in one place so a future store
 * refactor doesn't need to touch the execution hook.
 */
export function dispatchDbMutationHint(
  connectionId: string,
  paradigm: Paradigm,
  sql: string,
): void {
  void applyDbMutationHint(
    connectionId,
    paradigm,
    sql,
    useConnectionStore.getState().setActiveDb,
    useSchemaStore.getState().clearForConnection,
  );
}
