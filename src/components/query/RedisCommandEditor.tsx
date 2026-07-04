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
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import { autocompletion, acceptCompletion } from "@codemirror/autocomplete";
import { viewTableHighlightStyle } from "@lib/editor/highlightStyle";
import { autocompleteTooltipTheme } from "@lib/editor/autocompleteTheme";
import {
  createRedisCommandCompletionSource,
  type RedisCommandCompletionTarget,
  type RedisKeySuggestion,
} from "@features/completion";
import { editorContentAria } from "@lib/editor/editorContentAria";
import { setForwardedRef } from "@lib/editor/setForwardedRef";
import { syncEditorDocument } from "./editorDocumentSync";

export interface RedisCommandEditorProps {
  sql: string;
  onSqlChange: (sql: string) => void;
  onExecute: () => void;
  /**
   * Redis/Valkey dry-run IPC is unsupported; the shortcut still routes here so
   * the parent tab can show an explicit unsupported/info action.
   */
  onDryRun?: () => void;
  redisExtensions?: readonly Extension[];
  redisKeySuggestions?: readonly RedisKeySuggestion[];
  redisCommandTarget?: RedisCommandCompletionTarget;
}

function buildRedisCommandExtensions(
  redisExtensions: readonly Extension[],
  redisKeySuggestions: readonly RedisKeySuggestion[],
  redisCommandTarget: RedisCommandCompletionTarget,
): Extension {
  return [
    autocompletion({
      override: [
        createRedisCommandCompletionSource({
          keySuggestions: redisKeySuggestions,
          target: redisCommandTarget,
        }),
      ],
    }),
    ...redisExtensions,
  ];
}

const RedisCommandEditor = forwardRef<
  EditorView | null,
  RedisCommandEditorProps
>(function RedisCommandEditor(
  {
    sql,
    onSqlChange,
    onExecute,
    onDryRun,
    redisExtensions = [],
    redisKeySuggestions = [],
    redisCommandTarget = "redis",
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const { t } = useTranslation("query");
  const onSqlChangeRef = useRef(onSqlChange);
  onSqlChangeRef.current = onSqlChange;
  const onExecuteRef = useRef(onExecute);
  onExecuteRef.current = onExecute;
  const onDryRunRef = useRef(onDryRun);
  onDryRunRef.current = onDryRun;
  const sqlRef = useRef(sql);
  // #1133 — stable id linking `.cm-content` to the SR-only autocomplete hint.
  const hintId = useId();

  const editorLabel =
    redisCommandTarget === "valkey"
      ? t("redis.valkeyEditorAria")
      : t("redis.redisEditorAria");
  // ponytail: captured at mount; `redisCommandTarget` is fixed per connection
  // so the `.cm-content` name never goes stale in practice. Move into a
  // contentAttributes compartment reconfigure only if a live target swap ships.
  const editorLabelRef = useRef(editorLabel);
  editorLabelRef.current = editorLabel;

  const completionCompartment = useRef(new Compartment());

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: sqlRef.current,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        bracketMatching(),
        // #1225 — undo/redo history so Cmd+Z reverts edits (incl. paste).
        history(),
        placeholder("GET key"),
        completionCompartment.current.of(
          buildRedisCommandExtensions(
            redisExtensions,
            redisKeySuggestions,
            redisCommandTarget,
          ),
        ),
        syntaxHighlighting(viewTableHighlightStyle),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        // #1133 — name the real editable surface + describe the autocomplete
        // combobox on `.cm-content`, not on a decoy wrapper div.
        editorContentAria(editorLabelRef.current, hintId),
        keymap.of([
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
    // Completion props reconfigure in the effect below; remounting would
    // drop cursor and undo history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: completionCompartment.current.reconfigure(
        buildRedisCommandExtensions(
          redisExtensions,
          redisKeySuggestions,
          redisCommandTarget,
        ),
      ),
    });
  }, [redisExtensions, redisKeySuggestions, redisCommandTarget]);

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
        data-paradigm="kv"
        data-command-target={redisCommandTarget}
      />
      <span id={hintId} className="sr-only">
        {t("editorAutocompleteHint")}
      </span>
    </>
  );
});

export default RedisCommandEditor;
