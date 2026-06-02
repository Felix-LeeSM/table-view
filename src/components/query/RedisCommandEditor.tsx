import { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  placeholder,
} from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
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
  type RedisKeySuggestion,
} from "@lib/redis/redisCommandCompletion";

export interface RedisCommandEditorProps {
  sql: string;
  onSqlChange: (sql: string) => void;
  onExecute: () => void;
  onDryRun?: () => void;
  redisExtensions?: readonly Extension[];
  redisKeySuggestions?: readonly RedisKeySuggestion[];
}

function buildRedisCommandExtensions(
  redisExtensions: readonly Extension[],
  redisKeySuggestions: readonly RedisKeySuggestion[],
): Extension {
  return [
    autocompletion({
      override: [
        createRedisCommandCompletionSource({
          keySuggestions: redisKeySuggestions,
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
  // `onDryRun` is accepted for prop-shape parity with SQL/document editors.
  // Redis command dry-run has no runtime contract yet, so no key binding.
  {
    sql,
    onSqlChange,
    onExecute,
    redisExtensions = [],
    redisKeySuggestions = [],
  },
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

  const completionCompartment = useRef(new Compartment());

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: sqlRef.current,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        bracketMatching(),
        placeholder("GET key"),
        completionCompartment.current.of(
          buildRedisCommandExtensions(redisExtensions, redisKeySuggestions),
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
      effects: completionCompartment.current.reconfigure(
        buildRedisCommandExtensions(redisExtensions, redisKeySuggestions),
      ),
    });
  }, [redisExtensions, redisKeySuggestions]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc === sql) return;
    sqlRef.current = sql;
    view.dispatch({
      changes: { from: 0, to: currentDoc.length, insert: sql },
    });
  }, [sql]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
      role="textbox"
      aria-label="Redis Command Editor"
      aria-multiline="true"
      data-paradigm="kv"
    />
  );
});

export default RedisCommandEditor;
