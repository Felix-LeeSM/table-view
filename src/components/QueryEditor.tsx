import { useRef, useEffect } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { sql as sqlLanguage, StandardSQL, type SQLNamespace } from "@codemirror/lang-sql";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from "@codemirror/language";
import { autocompletion } from "@codemirror/autocomplete";

interface QueryEditorProps {
  sql: string;
  onSqlChange: (sql: string) => void;
  onExecute: () => void;
  schemaNamespace?: SQLNamespace;
}

export default function QueryEditor({ sql, onSqlChange, onExecute, schemaNamespace }: QueryEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

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
          ...defaultKeymap,
          indentWithTab,
          {
            key: "Mod-Enter",
            run: () => {
              onExecuteRef.current();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const doc = update.state.doc.toString();
            sqlRef.current = doc;
            onSqlChangeRef.current(doc);
          }
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px", backgroundColor: "var(--color-bg-primary)" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": {
            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            color: "var(--color-text-primary)",
          },
          ".cm-gutters": {
            backgroundColor: "var(--color-bg-secondary)",
            color: "var(--color-text-muted)",
            border: "none",
            borderRight: "1px solid var(--color-border)",
          },
          ".cm-activeLineGutter": { backgroundColor: "var(--color-bg-tertiary)" },
          ".cm-activeLine": { backgroundColor: "var(--color-bg-tertiary)" },
          ".cm-cursor": { borderLeftColor: "var(--color-text-primary)" },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
            backgroundColor: "var(--color-accent) !important",
            opacity: "0.3",
          },
          ".cm-matchingBracket": { backgroundColor: "var(--color-accent)", opacity: "0.3" },
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
    // Recreate editor when schemaNamespace changes (new tables loaded).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
}
