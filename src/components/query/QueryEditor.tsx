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
  type SQLNamespace,
} from "@codemirror/lang-sql";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { defaultKeymap } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import { autocompletion, acceptCompletion } from "@codemirror/autocomplete";
import type { Paradigm } from "@/types/connection";
import type { QueryMode } from "@stores/tabStore";

interface QueryEditorProps {
  sql: string;
  onSqlChange: (sql: string) => void;
  onExecute: () => void;
  schemaNamespace?: SQLNamespace;
  /**
   * Sprint 73 — paradigm of the hosting tab. `"rdb"` (default) keeps the
   * existing SQL language extension; `"document"` swaps in the JSON
   * language. Optional so pre-existing callers that always render SQL can
   * omit it without changing behaviour.
   */
  paradigm?: Paradigm;
  /**
   * Sprint 73 — query mode inside the paradigm. Document tabs pass
   * `"find"` or `"aggregate"` but the editor currently treats both as JSON
   * (stored for future differentiation such as MQL preview).
   */
  queryMode?: QueryMode;
}

const buildSqlLang = (ns: SQLNamespace | undefined): Extension =>
  sqlLanguage({
    dialect: StandardSQL,
    schema: ns,
    upperCaseKeywords: true,
  });

const buildJsonLang = (): Extension => jsonLanguage();

/**
 * Pick the CodeMirror language extension for the current paradigm.
 * `"document"` always uses JSON regardless of `queryMode`; `"rdb"` and any
 * future paradigms fall back to SQL. `schemaNamespace` is ignored for JSON
 * since MQL autocomplete isn't wired yet (Sprint 80).
 */
const buildLangExtension = (
  p: Paradigm,
  ns: SQLNamespace | undefined,
): Extension => (p === "document" ? buildJsonLang() : buildSqlLang(ns));

const QueryEditor = forwardRef<EditorView | null, QueryEditorProps>(
  function QueryEditor(
    {
      sql,
      onSqlChange,
      onExecute,
      schemaNamespace,
      paradigm = "rdb",
      queryMode,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    // Expose the EditorView to the parent via the forwarded ref.
    useImperativeHandle(ref, () => viewRef.current as EditorView, []);

    // Keep a ref to the latest callbacks so the listener closure always reads fresh values.
    const onSqlChangeRef = useRef(onSqlChange);
    onSqlChangeRef.current = onSqlChange;
    const onExecuteRef = useRef(onExecute);
    onExecuteRef.current = onExecute;

    // Keep a ref to the latest sql so we can avoid recreating the editor on every keystroke.
    const sqlRef = useRef(sql);

    // Schema identity flips whenever the schema store's columnsCache updates
    // (e.g. after a query runs and lazily fetches column metadata). Reconfiguring
    // through a Compartment keeps the editor alive across those updates — without
    // it the editor was being torn down and rebuilt mid-keystroke, which looked
    // like the query was re-executing on every character.
    //
    // Sprint 73 reuses the same Compartment for paradigm-driven language
    // swaps (SQL ↔ JSON). Paradigm changes are rare compared to schema
    // updates, and bundling both into one Compartment keeps the editor
    // alive across every reconfigure path.
    const langCompartment = useRef(new Compartment());
    const schemaNamespaceRef = useRef(schemaNamespace);
    schemaNamespaceRef.current = schemaNamespace;
    const paradigmRef = useRef<Paradigm>(paradigm);
    paradigmRef.current = paradigm;

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
            buildLangExtension(paradigmRef.current, schemaNamespaceRef.current),
          ),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          autocompletion(),
          keymap.of([
            // Custom bindings MUST come before defaultKeymap to take priority.
            // defaultKeymap also binds Mod-Enter (insertNewlineAndIndent), which
            // would otherwise intercept the keypress before our handler runs.
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
                // When the autocomplete popup is open, Tab should accept the
                // completion.  Without this explicit binding, CodeMirror falls
                // through to the default indentWithTab handler from
                // defaultKeymap (or a plain indent), which inserts whitespace
                // instead of accepting the suggestion.
                if (acceptCompletion(view)) return true;
                // No autocomplete active — fall through to default indent.
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
      // The editor is created once; schema updates are reconfigured below without
      // tearing the view down.
    }, []);

    // Reconfigure the language extension in place when paradigm or
    // schemaNamespace changes identity — keeps cursor/selection/doc intact.
    // Sprint 73 widened the dependency set from `schemaNamespace` to
    // `(paradigm, schemaNamespace)` so paradigm flips also reuse the
    // Compartment reconfigure path instead of tearing the editor down.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: langCompartment.current.reconfigure(
          buildLangExtension(paradigm, schemaNamespace),
        ),
      });
    }, [paradigm, schemaNamespace]);

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
      paradigm === "document"
        ? queryMode === "aggregate"
          ? "MongoDB Aggregate Pipeline Editor"
          : "MongoDB Find Query Editor"
        : "SQL Query Editor";

    return (
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden"
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        data-paradigm={paradigm}
        data-query-mode={queryMode ?? (paradigm === "rdb" ? "sql" : "find")}
      />
    );
  },
);

export default QueryEditor;
