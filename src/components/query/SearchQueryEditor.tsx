import { useEffect, forwardRef, useImperativeHandle, useRef } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { defaultKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { acceptCompletion, autocompletion } from "@codemirror/autocomplete";
import { viewTableHighlightStyle } from "@lib/editor/highlightStyle";
import { autocompleteTooltipTheme } from "@lib/editor/autocompleteTheme";
import { syncEditorDocument } from "./editorDocumentSync";

export interface SearchQueryEditorProps {
  sql: string;
  onSqlChange: (sql: string) => void;
  onExecute: () => void;
  onDryRun?: () => void;
  searchExtensions?: readonly Extension[];
}

function buildSearchExtensions(searchExtensions: readonly Extension[]) {
  return [jsonLanguage(), ...searchExtensions];
}

const SearchQueryEditor = forwardRef<EditorView | null, SearchQueryEditorProps>(
  function SearchQueryEditor(
    { sql, onSqlChange, onExecute, searchExtensions = [] },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    useImperativeHandle(ref, () => viewRef.current as EditorView, []);

    const onSqlChangeRef = useRef(onSqlChange);
    onSqlChangeRef.current = onSqlChange;
    const onExecuteRef = useRef(onExecute);
    onExecuteRef.current = onExecute;
    const sqlRef = useRef(sql);
    const languageCompartment = useRef(new Compartment());
    const searchExtensionsRef = useRef<readonly Extension[]>(searchExtensions);
    searchExtensionsRef.current = searchExtensions;

    useEffect(() => {
      if (!containerRef.current) return;

      const state = EditorState.create({
        doc: sqlRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          indentOnInput(),
          bracketMatching(),
          placeholder(
            '{ "query": { "match_all": {} }, "size": 10, "track_total_hits": true }',
          ),
          languageCompartment.current.of(
            buildSearchExtensions(searchExtensionsRef.current),
          ),
          syntaxHighlighting(viewTableHighlightStyle),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          autocompletion(),
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                onExecuteRef.current();
                return true;
              },
            },
            {
              key: "Tab",
              run: (view) => acceptCompletion(view),
            },
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const doc = update.state.doc.toString();
            sqlRef.current = doc;
            onSqlChangeRef.current(doc);
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

      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: languageCompartment.current.reconfigure(
          buildSearchExtensions(searchExtensions),
        ),
      });
    }, [searchExtensions]);

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
        aria-label="Search Query Editor"
        aria-multiline="true"
        data-paradigm="search"
      />
    );
  },
);

export default SearchQueryEditor;
