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
 * Paradigm-aware editor router. `rdb` → `SqlQueryEditor`, `document` →
 * `MongoQueryEditor`, kv/search → placeholder textbox until dedicated
 * editors land. Each paradigm-specific editor imports only its own
 * language + autocomplete extensions.
 *
 * The single-place "paradigm → editor" mapping lives here so future
 * paradigms plug in by extending one switch, and so the existing
 * `QueryEditor.test.tsx` paradigm-flip suite still asserts against a
 * stable surface.
 */

interface QueryEditorProps {
  sql: string;
  onSqlChange: (sql: string) => void;
  onExecute: () => void;
  /**
   * Sprint 248 (ADR 0022 Phase 4) — `Cmd+Shift+Enter` dry-run handler.
   * Forwarded to `SqlQueryEditor` (rdb) where the keymap binding lives;
   * `MongoQueryEditor` accepts the prop but does not bind any keymap
   * because the dry-run IPC is rdb-only.
   */
  onDryRun?: () => void;
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
      onDryRun,
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
            onDryRun={onDryRun}
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
            onDryRun={onDryRun}
            queryMode={queryMode ?? "find"}
            mongoExtensions={mongoExtensions ?? EMPTY_EXTENSIONS}
          />
        );
      case "kv":
      case "search":
        // Placeholder until dedicated editors land — keeps QueryTab's
        // layout stable.
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
              ? "Redis query editor is planned but not yet available."
              : "Search query editor is planned but not yet available."}
          </div>
        );
      default:
        return assertNever(paradigm);
    }
  },
);

export default QueryEditor;
