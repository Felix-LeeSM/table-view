import { forwardRef } from "react";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SQLDialect, SQLNamespace } from "@codemirror/lang-sql";
import type { Paradigm } from "@/types/connection";
import type { QueryMode } from "@stores/tabStore";
import { assertNever } from "@/lib/paradigm";
import SqlQueryEditor from "./SqlQueryEditor";
import MongoQueryEditor from "./MongoQueryEditor";

/**
 * Sprint 139 — paradigm-aware editor router.
 *
 * Previously a monolithic CodeMirror component that switched the language
 * extension internally based on the `paradigm` prop. The Sprint 139
 * refactor splits the implementation into two paradigm-specific editors
 * (`SqlQueryEditor`, `MongoQueryEditor`) so each one only imports the
 * autocomplete + language extensions for its own paradigm. The router
 * here preserves the existing public surface (props, ref forwarding,
 * aria-labels) so existing call sites + tests keep working unchanged.
 *
 * Why a router instead of inlining the switch into `QueryTab`? Two reasons:
 *
 * 1. Test scaffolding: the existing `QueryEditor.test.tsx` exercises the
 *    paradigm flip via prop changes; keeping the router keeps that suite
 *    relevant as a regression guard against the routing rules.
 * 2. Symmetry: future paradigms (kv, search) will plug into this router
 *    once their editors land. The router is the single place that knows
 *    "paradigm string → editor component" mapping.
 *
 * The kv / search paradigms render a placeholder textbox until Phase 9
 * lands their dedicated editors.
 */

interface QueryEditorProps {
  sql: string;
  onSqlChange: (sql: string) => void;
  onExecute: () => void;
  schemaNamespace?: SQLNamespace;
  /**
   * Paradigm of the hosting tab. `"rdb"` (default) routes to
   * `SqlQueryEditor`; `"document"` routes to `MongoQueryEditor`. Other
   * paradigms render a paradigm-tagged placeholder.
   */
  paradigm?: Paradigm;
  /**
   * Query mode inside the paradigm. Document tabs pass `"find"` or
   * `"aggregate"` (drives the aria-label of the underlying
   * MongoQueryEditor). Ignored by the SQL editor.
   */
  queryMode?: QueryMode;
  /**
   * The CodeMirror `SQLDialect` to use when the tab is in the `rdb`
   * paradigm. Ignored for other paradigms but always accepted so the
   * caller can pass it unconditionally.
   */
  sqlDialect?: SQLDialect;
  /**
   * MongoDB-aware CodeMirror extensions (autocomplete override + operator
   * highlight) produced by `useMongoAutocomplete`. Only forwarded when
   * `paradigm === "document"`. Other paradigms ignore the prop so callers
   * can pass it unconditionally.
   */
  mongoExtensions?: readonly Extension[];
}

const EMPTY_EXTENSIONS: readonly Extension[] = [];

const QueryEditor = forwardRef<EditorView | null, QueryEditorProps>(
  function QueryEditor(
    {
      sql,
      onSqlChange,
      onExecute,
      schemaNamespace,
      paradigm = "rdb",
      queryMode,
      sqlDialect,
      mongoExtensions,
    },
    ref,
  ) {
    switch (paradigm) {
      case "rdb":
        return (
          <SqlQueryEditor
            ref={ref}
            sql={sql}
            onSqlChange={onSqlChange}
            onExecute={onExecute}
            schemaNamespace={schemaNamespace}
            sqlDialect={sqlDialect}
          />
        );
      case "document":
        return (
          <MongoQueryEditor
            ref={ref}
            sql={sql}
            onSqlChange={onSqlChange}
            onExecute={onExecute}
            queryMode={queryMode ?? "find"}
            mongoExtensions={mongoExtensions ?? EMPTY_EXTENSIONS}
          />
        );
      case "kv":
      case "search":
        // Phase 9 will land dedicated editors for these paradigms. Until
        // then we render a paradigm-tagged placeholder so QueryTab has a
        // stable container to mount alongside its toolbar.
        return (
          <div
            className="flex h-full w-full items-center justify-center overflow-hidden bg-background p-4 text-center text-sm text-muted-foreground"
            role="textbox"
            aria-label={
              paradigm === "kv"
                ? "Key-Value Query Editor"
                : "Search Query Editor"
            }
            aria-multiline="true"
            data-paradigm={paradigm}
            data-query-mode={queryMode ?? paradigm}
          >
            {paradigm === "kv"
              ? "Redis editor coming in Phase 9."
              : "Search editor coming in Phase 9."}
          </div>
        );
      default:
        return assertNever(paradigm);
    }
  },
);

export default QueryEditor;
