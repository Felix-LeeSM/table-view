import { useRef, useEffect, forwardRef } from "react";
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

  const editorLabel =
    redisCommandTarget === "valkey"
      ? t("redis.valkeyEditorAria")
      : t("redis.redisEditorAria");

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
      role="textbox"
      aria-label={editorLabel}
      aria-multiline="true"
      data-paradigm="kv"
      data-command-target={redisCommandTarget}
    />
  );
});

export default RedisCommandEditor;
