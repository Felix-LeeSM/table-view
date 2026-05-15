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
  type SQLDialect,
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
import { updateColumnCompletionSource } from "@lib/sql/updateColumnCompletion";
import { aliasColumnCompletionSource } from "@lib/sql/aliasColumnCompletion";
import { cteColumnCompletionSource } from "@lib/sql/cteColumnCompletion";
import { wrappedSchemaCompletionSource } from "@lib/sql/schemaCompletionWrapper";
import { viewTableHighlightStyle } from "@lib/editor/highlightStyle";
import { autocompleteTooltipTheme } from "@lib/editor/autocompleteTheme";

/**
 * RDB / SQL-paradigm query editor. Imports only SQL-aware extensions —
 * never the JSON language extension or `useMongoAutocomplete`, so
 * cross-paradigm contamination is structurally impossible. Falls back to
 * `StandardSQL` when `sqlDialect` is missing (e.g. tab whose connection
 * was deleted mid-session).
 */

export interface SqlQueryEditorProps {
  sql: string;
  onSqlChange: (sql: string) => void;
  onExecute: () => void;
  /**
   * Sprint 248 (ADR 0022 Phase 4) — `Cmd+Shift+Enter` dry-run handler.
   * Optional so non-tab callers (DDL editor previews, story-book) can
   * keep mounting `SqlQueryEditor` without supplying it; when omitted
   * the keymap binding routes to a no-op so `Cmd+Shift+Enter` falls
   * through to the default keymap.
   */
  onDryRun?: () => void;
  /**
   * SQL namespace produced by `useSqlAutocomplete`. Drives the autocomplete
   * popup with table / view / column / function / keyword candidates. May
   * be `undefined` (e.g. before the schema store has loaded), in which case
   * CodeMirror's built-in SQL completions still work but no schema-derived
   * candidates appear.
   */
  schemaNamespace?: SQLNamespace;
  /**
   * The CodeMirror `SQLDialect` to use for parsing + keyword highlighting.
   * Mapped from the active connection's `db_type` upstream by
   * `databaseTypeToSqlDialect`. When omitted falls back to `StandardSQL`.
   */
  sqlDialect?: SQLDialect;
}

const buildSqlLang = (
  dialect: SQLDialect,
  ns: SQLNamespace | undefined,
): Extension => [
  // Sprint 304 (2026-05-14) — `schema` 인자 *제거*. lang-sql 의 자동
  // schemaCompletionSource wire 는 ns top-level (table) 을 모든 컨텍스트
  // 에서 emit 해 우리 column source 와 같은 라벨이 popup 에 두 번
  // 노출됐다. wrappedSchemaCompletionSource 가 같은 lang-sql source 를
  // 호출하지만 column-only 컨텍스트에서 table 후보를 제거한다.
  sqlLanguage({
    dialect,
    upperCaseKeywords: true,
  }),
  dialect.language.data.of({
    autocomplete: wrappedSchemaCompletionSource(() => ns, dialect),
  }),
  // 2026-05-11 — supplement lang-sql's built-in `schemaCompletionSource`,
  // which only resolves a target table behind `FROM`. Without this,
  // `UPDATE users SET <cursor>` and `INSERT INTO users (<cursor>)` get
  // no column candidates. The source is scoped to the active SQL
  // language so it stays dormant outside SQL contexts.
  dialect.language.data.of({
    autocomplete: updateColumnCompletionSource(() => ns),
  }),
  // Sprint 294 (2026-05-14) — alias-aware mid-typing flow. lang-sql 의 alias
  // map 은 cursor 의 Statement 안에 FROM 절이 이미 있을 때만 작동 → 사용자
  // 가 SELECT projection 을 먼저 입력하는 일반 패턴 (`SELECT u.` + 후행
  // FROM) 에서 후보 0. 이 source 는 buffer 전체에서 FROM/JOIN alias 패턴을
  // 탐색해 anywhere-scan 으로 보강한다.
  dialect.language.data.of({
    autocomplete: aliasColumnCompletionSource(() => ns),
  }),
  // Sprint 295 (2026-05-14) — CTE / derived subquery virtual table. paren-
  // depth-aware mini-parser 가 `WITH <name> AS (<inner-select>)` 와 `FROM
  // (<inner-select>) [AS] <alias>` 의 projection list 를 추출해 가상
  // 컬럼을 alias prefix 후보로 emit. base table 의 실제 컬럼은 위 alias
  // source 가 담당하므로 가상 alias 와 base alias 가 같은 popup 에서
  // 충돌 없이 dedup 된다.
  dialect.language.data.of({
    autocomplete: cteColumnCompletionSource(() => ns),
  }),
];

const SqlQueryEditor = forwardRef<EditorView | null, SqlQueryEditorProps>(
  function SqlQueryEditor(
    { sql, onSqlChange, onExecute, onDryRun, schemaNamespace, sqlDialect },
    ref,
  ) {
    // Resolve dialect once so ref + reconfigure paths share the same value.
    const effectiveDialect: SQLDialect = sqlDialect ?? StandardSQL;
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
    // Sprint 248 — `onDryRun` ref so the keymap closure picks up the
    // latest handler without recreating the editor on every parent
    // re-render.
    const onDryRunRef = useRef(onDryRun);
    onDryRunRef.current = onDryRun;

    // Keep a ref to the latest sql so we can avoid recreating the editor
    // on every keystroke.
    const sqlRef = useRef(sql);

    // Compartment used to swap the SQL extension bundle without tearing
    // the editor down (preserves cursor / selection / history).
    const langCompartment = useRef(new Compartment());
    const schemaNamespaceRef = useRef(schemaNamespace);
    schemaNamespaceRef.current = schemaNamespace;
    const dialectRef = useRef<SQLDialect>(effectiveDialect);
    dialectRef.current = effectiveDialect;

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
            buildSqlLang(dialectRef.current, schemaNamespaceRef.current),
          ),
          syntaxHighlighting(viewTableHighlightStyle),
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
            // Sprint 248 (ADR 0022 Phase 4) — explicit dry-run shortcut.
            // Bound BEFORE defaultKeymap so the editor keystroke wins
            // over any default `Cmd-Shift-Enter` mapping. When `onDryRun`
            // is omitted, return `false` so the binding falls through
            // (keeps non-tab callers' default behaviour intact).
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

    // Reconfigure the SQL extension bundle in place when dialect or schema
    // identity changes — keeps cursor/selection intact.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: langCompartment.current.reconfigure(
          buildSqlLang(effectiveDialect, schemaNamespace),
        ),
      });
    }, [effectiveDialect, schemaNamespace]);

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
        data-paradigm="rdb"
        data-query-mode="sql"
      />
    );
  },
);

export default SqlQueryEditor;
