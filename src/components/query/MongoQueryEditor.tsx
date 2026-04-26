import { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
} from "@codemirror/view";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { defaultKeymap } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import { autocompletion, acceptCompletion } from "@codemirror/autocomplete";
import type { QueryMode } from "@stores/tabStore";

/**
 * Sprint 139 — MongoDB / document-paradigm query editor.
 *
 * Extracted from the previous monolithic `QueryEditor` so the autocomplete
 * provider it registers is exclusively MQL-aware. The editor never imports
 * `useSqlAutocomplete` and never installs the SQL language extension —
 * cross-contamination between paradigms is structurally impossible.
 *
 * Receives the same minimal props the document branch of QueryEditor used to
 * receive: editor body (`sql`, `onSqlChange`), Mod-Enter execute callback
 * (`onExecute`), the QueryMode for aria-label disambiguation, and the
 * paradigm-derived MongoDB extensions (autocomplete override + operator
 * highlight) produced by `useMongoAutocomplete`.
 */

export interface MongoQueryEditorProps {
  sql: string;
  onSqlChange: (sql: string) => void;
  onExecute: () => void;
  /**
   * `"find"` or `"aggregate"` — drives the aria-label so screen readers
   * disambiguate between the two MongoDB editor variants.
   */
  queryMode: QueryMode;
  /**
   * MongoDB-aware CodeMirror extensions: autocomplete override populated
   * with MQL operators / pipeline stages / accumulators / type tags +
   * collection field names, and the operator highlight ViewPlugin. The
   * caller (typically `useMongoAutocomplete`) owns memoisation so the
   * editor reconfigures through a Compartment instead of rebuilding.
   */
  mongoExtensions: readonly Extension[];
}

const buildJsonLang = (mongoExtensions: readonly Extension[]): Extension => [
  jsonLanguage(),
  ...mongoExtensions,
];

const MongoQueryEditor = forwardRef<EditorView | null, MongoQueryEditorProps>(
  function MongoQueryEditor(
    { sql, onSqlChange, onExecute, queryMode, mongoExtensions },
    ref,
  ) {
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

    // Compartment used to swap the JSON + Mongo extension bundle without
    // tearing the editor down (preserves cursor / selection / history).
    const langCompartment = useRef(new Compartment());
    const mongoExtensionsRef = useRef<readonly Extension[]>(mongoExtensions);
    mongoExtensionsRef.current = mongoExtensions;

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
          langCompartment.current.of(buildJsonLang(mongoExtensionsRef.current)),
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

    // Reconfigure the JSON + Mongo extension bundle in place when the
    // mongoExtensions identity changes — keeps cursor/selection intact.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: langCompartment.current.reconfigure(
          buildJsonLang(mongoExtensions),
        ),
      });
    }, [mongoExtensions]);

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

    const ariaLabel =
      queryMode === "aggregate"
        ? "MongoDB Aggregate Pipeline Editor"
        : "MongoDB Find Query Editor";

    return (
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden"
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        data-paradigm="document"
        data-query-mode={queryMode ?? "find"}
      />
    );
  },
);

export default MongoQueryEditor;
