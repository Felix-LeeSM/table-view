import { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
} from "@codemirror/view";
import {
  sql as sqlLanguage,
  StandardSQL,
  type SQLDialect,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import { defaultKeymap } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import { autocompletion, acceptCompletion } from "@codemirror/autocomplete";

/**
 * Sprint 139 — RDB / SQL-paradigm query editor.
 *
 * Extracted from the previous monolithic `QueryEditor` so the autocomplete
 * provider and language extension this editor installs are exclusively
 * SQL-aware. The editor never imports `useMongoAutocomplete` and never
 * installs the JSON language extension — cross-contamination between
 * paradigms is structurally impossible.
 *
 * Receives the same minimal props the RDB branch of QueryEditor used to
 * receive: editor body (`sql`, `onSqlChange`), Mod-Enter execute callback
 * (`onExecute`), the dialect-aware SQL namespace (`schemaNamespace`) used
 * for autocomplete candidates, and the `SQLDialect` for keyword highlighting
 * + identifier-quoting behaviour. When `sqlDialect` is omitted the editor
 * falls back to `StandardSQL` so a tab whose connection has been deleted
 * mid-session still renders.
 */

export interface SqlQueryEditorProps {
  sql: string;
  onSqlChange: (sql: string) => void;
  onExecute: () => void;
  /**
   * SQL namespace produced by `useSqlAutocomplete`. Drives the autocomplete
   * popup with table / view / column / function / keyword candidates. May
   * be `undefined` (e.g. before the schema store has loaded), in which case
   * CodeMirror's built-in SQL completions still work but no schema-derived
   * candidates appear.
   */
  schemaNamespace?: SQLNamespace;
  /**
   * The CodeMirror `SQLDialect` to use for parsing + keyword highlighting.
   * Mapped from the active connection's `db_type` upstream by
   * `databaseTypeToSqlDialect`. When omitted falls back to `StandardSQL`.
   */
  sqlDialect?: SQLDialect;
}

const buildSqlLang = (
  dialect: SQLDialect,
  ns: SQLNamespace | undefined,
): Extension =>
  sqlLanguage({
    dialect,
    schema: ns,
    upperCaseKeywords: true,
  });

const SqlQueryEditor = forwardRef<EditorView | null, SqlQueryEditorProps>(
  function SqlQueryEditor(
    { sql, onSqlChange, onExecute, schemaNamespace, sqlDialect },
    ref,
  ) {
    // Resolve dialect once so ref + reconfigure paths share the same value.
    const effectiveDialect: SQLDialect = sqlDialect ?? StandardSQL;
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    // Expose the EditorView to the parent via the forwarded ref.
    useImperativeHandle(ref, () => viewRef.current as EditorView, []);

    // Keep refs to latest callbacks so the listener closure always reads
    // fresh values without recreating the editor.
    const onSqlChangeRef = useRef(onSqlChange);
    onSqlChangeRef.current = onSqlChange;
    const onExecuteRef = useRef(onExecute);
    onExecuteRef.current = onExecute;

    // Keep a ref to the latest sql so we can avoid recreating the editor
    // on every keystroke.
    const sqlRef = useRef(sql);

    // Compartment used to swap the SQL extension bundle without tearing
    // the editor down (preserves cursor / selection / history).
    const langCompartment = useRef(new Compartment());
    const schemaNamespaceRef = useRef(schemaNamespace);
    schemaNamespaceRef.current = schemaNamespace;
    const dialectRef = useRef<SQLDialect>(effectiveDialect);
    dialectRef.current = effectiveDialect;

    // Create the CodeMirror editor once.
    useEffect(() => {
      if (!containerRef.current) return;

      const state = EditorState.create({
        doc: sqlRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          indentOnInput(),
          bracketMatching(),
          langCompartment.current.of(
            buildSqlLang(dialectRef.current, schemaNamespaceRef.current),
          ),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          autocompletion(),
          keymap.of([
            // Custom bindings MUST come before defaultKeymap to take
            // priority — defaultKeymap also binds Mod-Enter.
            {
              key: "Mod-Enter",
              run: () => {
                onExecuteRef.current();
                return true;
              },
            },
            {
              key: "Tab",
              run: (view) => {
                if (acceptCompletion(view)) return true;
                return false;
              },
            },
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const doc = update.state.doc.toString();
              sqlRef.current = doc;
              onSqlChangeRef.current(doc);
            }
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              fontSize: "13px",
              backgroundColor: "var(--background)",
            },
            ".cm-scroller": { overflow: "auto" },
            ".cm-content": {
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
              color: "var(--foreground)",
            },
            ".cm-gutters": {
              backgroundColor: "var(--secondary)",
              color: "var(--muted-foreground)",
              border: "none",
              borderRight: "1px solid var(--border)",
            },
            ".cm-activeLineGutter": {
              backgroundColor: "var(--muted)",
            },
            ".cm-activeLine": { backgroundColor: "var(--muted)" },
            ".cm-cursor": { borderLeftColor: "var(--foreground)" },
            "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
              backgroundColor: "var(--primary) !important",
              opacity: "0.3",
            },
            ".cm-matchingBracket": {
              backgroundColor: "var(--primary)",
              opacity: "0.3",
            },
          }),
        ],
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      viewRef.current = view;

      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, []);

    // Reconfigure the SQL extension bundle in place when dialect or schema
    // identity changes — keeps cursor/selection intact.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: langCompartment.current.reconfigure(
          buildSqlLang(effectiveDialect, schemaNamespace),
        ),
      });
    }, [effectiveDialect, schemaNamespace]);

    // Sync external sql changes into the editor (e.g. when switching tabs).
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const currentDoc = view.state.doc.toString();
      if (currentDoc !== sql) {
        sqlRef.current = sql;
        view.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: sql },
        });
      }
    }, [sql]);

    return (
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden"
        role="textbox"
        aria-label="SQL Query Editor"
        aria-multiline="true"
        data-paradigm="rdb"
        data-query-mode="sql"
      />
    );
  },
);

export default SqlQueryEditor;
