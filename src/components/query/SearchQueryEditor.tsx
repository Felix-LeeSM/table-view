import { useEffect, forwardRef, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { acceptCompletion, autocompletion } from "@codemirror/autocomplete";
import { viewTableHighlightStyle } from "@lib/editor/highlightStyle";
import { autocompleteTooltipTheme } from "@lib/editor/autocompleteTheme";
import { editorContentAria } from "@lib/editor/editorContentAria";
import { hideGutterFromA11y } from "@lib/editor/hideGutterFromA11y";
import { setForwardedRef } from "@lib/editor/setForwardedRef";
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
    const { t } = useTranslation("query");
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    // #1133 — stable id linking `.cm-content` to the SR-only autocomplete hint.
    const hintId = useId();

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
          // #1225 — undo/redo history so Cmd+Z reverts edits (incl. paste).
          history(),
          placeholder(
            '{ "query": { "match_all": {} }, "size": 10, "track_total_hits": true }',
          ),
          languageCompartment.current.of(
            buildSearchExtensions(searchExtensionsRef.current),
          ),
          syntaxHighlighting(viewTableHighlightStyle),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          autocompletion(),
          // #1133 — name the real editable surface + describe the autocomplete
          // combobox on `.cm-content`, not on a decoy wrapper div.
          editorContentAria(t("search.editorAria"), hintId),
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
            // #1225 — Mod-z / Mod-y undo/redo (defaultKeymap omits these).
            ...historyKeymap,
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
      // #1142 — line-number gutter is decorative; hide it from the a11y tree.
      hideGutterFromA11y(view);
      // Expose the live EditorView to the parent's forwarded ref (#1248).
      setForwardedRef(ref, view);
      // #1133 — unified mount focus across all four query editors so a freshly
      // opened tab is immediately typeable on the `.cm-content` surface.
      view.focus();

      return () => {
        view.destroy();
        viewRef.current = null;
        setForwardedRef(ref, null);
      };
      // Mount-once: create the EditorView a single time. Completion/theme
      // props reconfigure via the Compartment effect below; remounting here
      // would drop cursor + undo history (cf. RedisCommandEditor).
      // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // #1133 — the accessible name and combobox aria live on the real
    // `.cm-content`; the wrapper is no longer a decoy textbox.
    return (
      <>
        <div
          ref={containerRef}
          className="h-full w-full overflow-hidden"
          data-paradigm="search"
        />
        <span id={hintId} className="sr-only">
          {t("editorAutocompleteHint")}
        </span>
      </>
    );
  },
);

export default SearchQueryEditor;
