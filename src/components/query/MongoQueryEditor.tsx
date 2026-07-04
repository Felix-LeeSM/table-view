import { useRef, useEffect, useId, forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  placeholder,
} from "@codemirror/view";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import { autocompletion, acceptCompletion } from "@codemirror/autocomplete";
import { viewTableHighlightStyle } from "@lib/editor/highlightStyle";
import { autocompleteTooltipTheme } from "@lib/editor/autocompleteTheme";
import { editorContentAria } from "@lib/editor/editorContentAria";
import { setForwardedRef } from "@lib/editor/setForwardedRef";
import { syncEditorDocument } from "./editorDocumentSync";

/**
 * MongoDB / document-paradigm query editor. Imports only MQL-aware
 * extensions — never the SQL language extension or `useSqlAutocomplete`,
 * so cross-paradigm contamination is structurally impossible.
 *
 * Sprint 309 — Find/Aggregate prop removed; the editor is a single
 * mongosh surface. The wrapper `<div>` no longer carries the mode
 * data-attribute, and the aria-label is the single string
 * `"MongoDB Query Editor"`. Mode routing moved from "user toggle →
 * dispatch" to "parser reads editor text → dispatch" (A5 owns the
 * dispatch swap; A3 just simplifies the editor surface).
 */

export interface MongoQueryEditorProps {
  sql: string;
  onSqlChange: (sql: string) => void;
  onExecute: () => void;
  /**
   * Sprint 248 (ADR 0022 Phase 4) — `Cmd+Shift+Enter` dry-run handler.
   * MongoDB dry-run IPC is unsupported; the binding still calls this handler
   * so the tab can surface the same explicit info/unsupported action instead
   * of making the shortcut feel broken.
   */
  onDryRun?: () => void;
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
    // Sprint 309 — paradigm-mode prop dropped from the interface; the
    // editor surface is a single mongosh-flavoured CodeMirror instance.
    { sql, onSqlChange, onExecute, onDryRun, mongoExtensions },
    ref,
  ) {
    const { t } = useTranslation("query");
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    // #1133 — stable id linking `.cm-content` to the SR-only autocomplete hint.
    const hintId = useId();

    // Keep refs to latest callbacks so the listener closure always reads
    // fresh values without recreating the editor.
    const onSqlChangeRef = useRef(onSqlChange);
    onSqlChangeRef.current = onSqlChange;
    const onExecuteRef = useRef(onExecute);
    onExecuteRef.current = onExecute;
    const onDryRunRef = useRef(onDryRun);
    onDryRunRef.current = onDryRun;

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
          // First-run affordance: tell the user the editor accepts
          // mongosh expressions (`db.<collection>.<method>(...)`) so they
          // are not staring at a blank pane wondering what syntax to type.
          placeholder("db.collection.find({})"),
          // #1225 — undo/redo history so Cmd+Z reverts edits (incl. paste).
          history(),
          langCompartment.current.of(buildJsonLang(mongoExtensionsRef.current)),
          syntaxHighlighting(viewTableHighlightStyle),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          autocompletion(),
          // #1133 — name the real editable surface + describe the autocomplete
          // combobox on `.cm-content`, not on a decoy wrapper div.
          editorContentAria(t("mongo.editorAria"), hintId),
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
            // #1225 — Mod-z / Mod-y undo/redo (defaultKeymap omits these).
            ...historyKeymap,
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
            ".cm-mql-operator": {
              color: "var(--tv-syntax-keyword)",
              fontWeight: "600",
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (syncEditorDocument(view, sql)) sqlRef.current = sql;
    }, [sql]);

    // #1133 — the accessible name and combobox aria live on the real
    // `.cm-content`; the wrapper is no longer a decoy textbox.
    return (
      <>
        <div
          ref={containerRef}
          className="h-full w-full overflow-hidden"
          data-paradigm="document"
        />
        <span id={hintId} className="sr-only">
          {t("editorAutocompleteHint")}
        </span>
      </>
    );
  },
);

export default MongoQueryEditor;
