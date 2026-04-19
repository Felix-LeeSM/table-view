import { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { EditorState } from "@codemirror/state";
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
import { defaultKeymap } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import { autocompletion, acceptCompletion } from "@codemirror/autocomplete";

interface QueryEditorProps {
  sql: string;
  onSqlChange: (sql: string) => void;
  onExecute: () => void;
  schemaNamespace?: SQLNamespace;
}

const QueryEditor = forwardRef<EditorView | null, QueryEditorProps>(
  function QueryEditor({ sql, onSqlChange, onExecute, schemaNamespace }, ref) {
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
          sqlLanguage({ dialect: StandardSQL, schema: schemaNamespace }),
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
    }, [schemaNamespace]);

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
      />
    );
  },
);

export default QueryEditor;
