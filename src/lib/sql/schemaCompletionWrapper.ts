import {
  schemaCompletionSource,
  type SQLDialect,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import type {
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { detectCursorClause } from "./cursorClause";

/**
 * Sprint 304 (2026-05-14) — schemaCompletionSource wrapper.
 *
 * lang-sql 의 `schemaCompletionSource` 는 `SQLNamespace` 의 top-level key
 * (= table / view) 를 *모든 cursor 컨텍스트* 에서 `type: "type"` (`t`
 * 아이콘) 으로 emit. 우리 `updateColumnCompletionSource` /
 * `aliasColumnCompletionSource` / `cteColumnCompletionSource` 가 같은
 * 자리에서 컬럼을 `type: "property"` (`□` 아이콘) 로 emit. CodeMirror
 * 의 autocomplete 는 source 간 dedup 을 하지 않으므로 같은 라벨이
 * popup 에 두 번 (table + column) 노출됐다. 2026-05-14 사용자 보고:
 * "column 이 두 번씩 나열되고 왼쪽 아이콘이 다른 게 뜨네".
 *
 * 이 wrapper 는 lang-sql 의 schemaCompletion 결과를 *후처리* 한다:
 *   - cursor 가 `column-only` 위치 (`WHERE` / `SET` / `SELECT` projection
 *     / `ORDER BY` / `GROUP BY` / `HAVING` / `ON` 등) 이면 `type === "type"`
 *     옵션 (= table 후보) 을 제거. `type === "property"` (column / alias
 *     emit) 은 통과.
 *   - cursor 가 `table-allowed` 위치 (`FROM` / `JOIN` / `INSERT INTO` /
 *     `UPDATE` 직후) 이면 결과 그대로 통과.
 *
 * 사용 방법: `sql({ dialect, upperCaseKeywords })` 를 schema 인자 *없이*
 * 호출해 lang-sql 의 자동 schemaCompletion wire 를 끄고, 대신 본 wrapper
 * 를 `dialect.language.data.of({ autocomplete })` 로 따로 등록한다.
 * 그래야 lang-sql 의 alias map (FROM 절이 이미 있는 statement 의
 * `<table> <alias>` 매핑) 도 wrapper 를 통해 보존된다 —
 * `schemaCompletionSource` 가 ns 와 dialect 만 받으면 alias 처리는
 * 그대로 내부에서 수행.
 */
export function wrappedSchemaCompletionSource(
  getSchema: () => SQLNamespace | undefined,
  dialect: SQLDialect,
): CompletionSource {
  // schemaCompletionSource 는 호출 시점에 schema 를 capture. 우리 ns 는
  // dialect / schema reconfigure 시 새 객체로 바뀌므로, source 인스턴스도
  // 같은 시점에 재생성되어야 한다. SqlQueryEditor 의 langCompartment 가
  // ns 변경 시 buildSqlLang 을 재호출하므로 wrapper 도 그 시점에 새로
  // 생성된다 — 즉 source 인스턴스 inside-closure capture 가 정확하다.
  let innerSource: CompletionSource | null = null;
  const ensureInner = (): CompletionSource | null => {
    const schema = getSchema();
    if (!schema) return null;
    if (!innerSource) {
      innerSource = schemaCompletionSource({ schema, dialect });
    }
    return innerSource;
  };

  const applyFilter = (
    result: CompletionResult | null,
    context: CompletionContext,
  ): CompletionResult | null => {
    if (!result) return null;
    const clause = detectCursorClause(context.state, context.pos);
    if (clause === "table-allowed") return result;
    // column-only — table 후보 (`type === "type"`) 제거.
    const filtered = result.options.filter((opt) => opt.type !== "type");
    if (filtered.length === result.options.length) return result;
    return { ...result, options: filtered };
  };

  return (
    context: CompletionContext,
  ): CompletionResult | Promise<CompletionResult | null> | null => {
    const inner = ensureInner();
    if (!inner) return null;
    const result = inner(context);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<CompletionResult | null>).then((r) =>
        applyFilter(r, context),
      );
    }
    return applyFilter(result as CompletionResult | null, context);
  };
}
