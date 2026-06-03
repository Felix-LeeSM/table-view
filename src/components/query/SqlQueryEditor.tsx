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
import { createSqlHybridCompletionSource } from "@lib/sql/sqlHybridCompletionSource";
import type { SqlCompletionContext } from "@lib/sql/sqlCompletionContext";
import { viewTableHighlightStyle } from "@lib/editor/highlightStyle";
import { autocompleteTooltipTheme } from "@lib/editor/autocompleteTheme";
import { syncEditorDocument } from "./editorDocumentSync";

/**
 * RDB / SQL-paradigm query editor. Imports only SQL-aware extensions —
 * never the JSON language extension or `useMongoAutocomplete`, so
 * cross-paradigm contamination is structurally impossible. Falls back to
 * `StandardSQL` when `sqlDialect` is missing (e.g. tab whose connection
 * was deleted mid-session).
 */

export interface SqlQueryEditorProps {
  sql: string;
  onSqlChange: (sql: string) => void;
  onExecute: () => void;
  /**
   * Sprint 248 (ADR 0022 Phase 4) — `Cmd+Shift+Enter` dry-run handler.
   * Optional so non-tab callers (DDL editor previews, story-book) can
   * keep mounting `SqlQueryEditor` without supplying it; when omitted
   * the keymap binding routes to a no-op so `Cmd+Shift+Enter` falls
   * through to the default keymap.
   */
  onDryRun?: () => void;
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
   * Mapped from the active connection's `dbType` upstream by
   * `databaseTypeToSqlDialect`. When omitted falls back to `StandardSQL`.
   */
  sqlDialect?: SQLDialect;
  completionContext?: SqlCompletionContext;
}

const buildSqlLang = (
  dialect: SQLDialect,
  ns: SQLNamespace | undefined,
  getCompletionContext: () => SqlCompletionContext | null | undefined,
): Extension => [
  sqlLanguage({
    dialect,
    upperCaseKeywords: true,
  }),
  dialect.language.data.of({
    autocomplete: createSqlHybridCompletionSource({
      dialect,
      getNamespace: () => ns,
      getCompletionContext,
    }),
  }),
];

const SqlQueryEditor = forwardRef<EditorView | null, SqlQueryEditorProps>(
  function SqlQueryEditor(
    {
      sql,
      onSqlChange,
      onExecute,
      onDryRun,
      schemaNamespace,
      sqlDialect,
      completionContext,
    },
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
    // Sprint 248 — `onDryRun` ref so the keymap closure picks up the
    // latest handler without recreating the editor on every parent
    // re-render.
    const onDryRunRef = useRef(onDryRun);
    onDryRunRef.current = onDryRun;

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
    const completionContextRef = useRef(completionContext);
    completionContextRef.current = completionContext;

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
            buildSqlLang(
              dialectRef.current,
              schemaNamespaceRef.current,
              () => completionContextRef.current,
            ),
          ),
          syntaxHighlighting(viewTableHighlightStyle),
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
            // Sprint 248 (ADR 0022 Phase 4) — explicit dry-run shortcut.
            // Bound BEFORE defaultKeymap so the editor keystroke wins
            // over any default `Cmd-Shift-Enter` mapping. When `onDryRun`
            // is omitted, return `false` so the binding falls through
            // (keeps non-tab callers' default behaviour intact).
            {
              key: "Cmd-Shift-Enter",
              run: () => {
                const handler = onDryRunRef.current;
                if (!handler) return false;
                handler();
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
              backgroundColor: "var(--tv-background)",
            },
            ".cm-scroller": { overflow: "auto" },
            ".cm-content": {
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
              color: "var(--tv-foreground)",
            },
            ".cm-gutters": {
              backgroundColor: "var(--tv-secondary)",
              color: "var(--tv-muted-foreground)",
              border: "none",
              borderRight: "1px solid var(--tv-border)",
            },
            ".cm-activeLineGutter": {
              backgroundColor: "var(--tv-muted)",
            },
            ".cm-activeLine": { backgroundColor: "var(--tv-muted)" },
            ".cm-cursor": { borderLeftColor: "var(--tv-foreground)" },
            "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
              backgroundColor: "var(--tv-primary) !important",
              opacity: "0.3",
            },
            ".cm-matchingBracket": {
              backgroundColor: "var(--tv-primary)",
              opacity: "0.3",
            },
          }),
          autocompleteTooltipTheme,
        ],
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      viewRef.current = view;

      // Wave 9.5 회귀 5 (2026-05-16) — 새 raw query tab 이 열리면 텍스트를
      // 바로 입력할 수 있도록 contenteditable surface (`.cm-content`) 에
      // 자동 focus. user journey: Cmd+N → tab 새로 mount → editor focus
      // → 타이핑 즉시 가능.
      view.focus();

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
          buildSqlLang(
            effectiveDialect,
            schemaNamespace,
            () => completionContextRef.current,
          ),
        ),
      });
    }, [effectiveDialect, schemaNamespace]);

    // Sync external sql changes into the editor (e.g. when switching tabs).
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      if (syncEditorDocument(view, sql)) sqlRef.current = sql;
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
