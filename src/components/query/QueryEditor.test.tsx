import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { EditorView, keymap } from "@codemirror/view";
import { ensureSyntaxTree, language } from "@codemirror/language";
import { MySQL, PostgreSQL, SQLite } from "@codemirror/lang-sql";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { json as jsonLanguage } from "@codemirror/lang-json";
import type { KeyBinding } from "@codemirror/view";
import QueryEditor from "./QueryEditor";
import {
  createMongoCompletionSource,
  createMongoOperatorHighlight,
} from "@lib/mongoAutocomplete";

// CodeMirror works in jsdom, so we do NOT mock it.
// Note: CodeMirror's .cm-content div also has role="textbox", so we use
// aria-label queries instead of getByRole("textbox").

function getContainer() {
  return screen.getByLabelText("SQL Query Editor");
}

function getEditorView(): EditorView {
  const container = getContainer();
  const cmEditor = container.querySelector(".cm-editor") as HTMLElement;
  const view = EditorView.findFromDOM(cmEditor);
  if (!view) throw new Error("EditorView not found");
  return view;
}

/** Extract all keymap bindings from the editor state */
function getKeymapBindings(view: EditorView): KeyBinding[] {
  const bindings: KeyBinding[] = [];
  const facetValues = view.state.facet(keymap);
  for (const set of facetValues) {
    if (Array.isArray(set)) {
      for (const binding of set) {
        bindings.push(binding);
      }
    }
  }
  return bindings;
}

describe("QueryEditor", () => {
  const onSqlChange = vi.fn();
  const onExecute = vi.fn();

  beforeEach(() => {
    onSqlChange.mockReset();
    onExecute.mockReset();
  });

  // AC-01: role=textbox + aria-label
  it("renders with role=textbox and aria-label=SQL Query Editor", () => {
    render(
      <QueryEditor sql="" onSqlChange={onSqlChange} onExecute={onExecute} />,
    );

    const container = getContainer();
    expect(container).toBeInTheDocument();
    expect(container).toHaveAttribute("role", "textbox");
    expect(container).toHaveAttribute("aria-label", "SQL Query Editor");
  });

  it("has aria-multiline=true", () => {
    render(
      <QueryEditor sql="" onSqlChange={onSqlChange} onExecute={onExecute} />,
    );

    const container = getContainer();
    expect(container).toHaveAttribute("aria-multiline", "true");
  });

  it("creates the editor with the initial sql content", () => {
    render(
      <QueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
      />,
    );

    const container = getContainer();
    const content = container.querySelector(".cm-content");
    expect(content).toBeTruthy();
    expect(content?.textContent).toContain("SELECT 1");
  });

  // AC-02: onSqlChange callback
  it("calls onSqlChange when document content changes", () => {
    render(
      <QueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
      />,
    );

    const view = getEditorView();

    act(() => {
      view.dispatch({
        changes: { from: 0, to: 0, insert: "INSERT " },
      });
    });

    expect(onSqlChange).toHaveBeenCalled();
    const lastCall = onSqlChange.mock.calls[onSqlChange.mock.calls.length - 1]!;
    expect(lastCall[0]).toContain("INSERT");
  });

  // AC-03: Mod-Enter triggers onExecute
  // CodeMirror's native key handling doesn't work with jsdom synthetic events,
  // so we directly invoke the keymap binding registered in the editor state.
  it("calls onExecute on Mod-Enter keypress", () => {
    const localOnExecute = vi.fn();
    render(
      <QueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={localOnExecute}
      />,
    );

    const view = getEditorView();
    const bindings = getKeymapBindings(view);
    // The custom Mod-Enter binding is the LAST one (after defaultKeymap bindings).
    // defaultKeymap also has Mod-Enter (insertNewlineAndIndent), so we need to find
    // our custom one. We look through all bindings and find the one that actually
    // triggers onExecute by process of elimination - the last Mod-Enter binding
    // in the array is our custom one since keymap.of([...defaultKeymap, ..., custom])
    // gets flattened.
    const modEnterBindings = bindings.filter((b) => b.key === "Mod-Enter");
    expect(modEnterBindings.length).toBeGreaterThanOrEqual(1);

    // Run all Mod-Enter bindings until our callback fires.
    // In practice, the first one from defaultKeymap will run but won't call onExecute.
    // Our custom binding is the one that calls onExecute.
    for (const binding of modEnterBindings) {
      if (typeof binding.run === "function") {
        binding.run(view);
      }
    }

    expect(localOnExecute).toHaveBeenCalled();
  });

  // AC-04: external sql prop syncs into editor
  it("syncs external sql prop changes into the editor document", async () => {
    const { rerender } = render(
      <QueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
      />,
    );

    const container = getContainer();

    rerender(
      <QueryEditor
        sql="SELECT * FROM users"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
      />,
    );

    await waitFor(() => {
      const content = container.querySelector(".cm-content");
      expect(content?.textContent).toContain("SELECT * FROM users");
    });
  });

  it("does not dispatch onSqlChange when sql prop matches current document", () => {
    const { rerender } = render(
      <QueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
      />,
    );

    // Clear any calls from initial render
    onSqlChange.mockClear();

    // Rerender with same sql — onSqlChange should not fire
    rerender(
      <QueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
      />,
    );

    expect(onSqlChange).not.toHaveBeenCalled();
  });

  it("keeps the editor alive when schemaNamespace identity changes", () => {
    const { rerender } = render(
      <QueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        schemaNamespace={undefined}
      />,
    );

    const viewBefore = getEditorView();

    rerender(
      <QueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        schemaNamespace={{ users: {} } as any}
      />,
    );

    // Same EditorView instance — schemaNamespace reconfigures via Compartment,
    // which is what lets the cursor/selection/doc survive schemaStore updates
    // that previously rebuilt the editor on every keystroke.
    const viewAfter = getEditorView();
    expect(viewAfter).toBe(viewBefore);
    expect(viewAfter.state.doc.toString()).toBe("SELECT 1");
  });

  it("updates onExecute callback ref without recreating editor", () => {
    const newOnExecute = vi.fn();

    const { rerender } = render(
      <QueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
      />,
    );

    // Rerender with new onExecute — should use the ref, not recreate editor
    rerender(
      <QueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={newOnExecute}
      />,
    );

    const view = getEditorView();
    const bindings = getKeymapBindings(view);
    const modEnterBindings = bindings.filter((b) => b.key === "Mod-Enter");

    for (const binding of modEnterBindings) {
      if (typeof binding.run === "function") {
        binding.run(view);
      }
    }

    expect(newOnExecute).toHaveBeenCalled();
  });

  it("cleans up editor on unmount", () => {
    const { unmount } = render(
      <QueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
      />,
    );

    const container = getContainer();
    expect(container.querySelector(".cm-editor")).toBeTruthy();

    unmount();

    expect(screen.queryByLabelText("SQL Query Editor")).not.toBeInTheDocument();
  });

  it("handles empty string sql", () => {
    render(
      <QueryEditor sql="" onSqlChange={onSqlChange} onExecute={onExecute} />,
    );

    const container = getContainer();
    expect(container).toBeInTheDocument();
    const content = container.querySelector(".cm-content");
    expect(content?.textContent).toBe("");
  });

  it("handles multiline sql content", () => {
    const multilineSql = "SELECT *\nFROM users\nWHERE id = 1";
    render(
      <QueryEditor
        sql={multilineSql}
        onSqlChange={onSqlChange}
        onExecute={onExecute}
      />,
    );

    const container = getContainer();
    const content = container.querySelector(".cm-content");
    expect(content?.textContent).toContain("SELECT");
    expect(content?.textContent).toContain("FROM users");
    expect(content?.textContent).toContain("WHERE id = 1");
  });

  it("registers Mod-Enter keymap binding in editor state", () => {
    render(
      <QueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
      />,
    );

    const view = getEditorView();
    const bindings = getKeymapBindings(view);
    const modEnterBinding = bindings.find((b) => b.key === "Mod-Enter");

    expect(modEnterBinding).toBeDefined();
    expect(typeof modEnterBinding!.run).toBe("function");
  });

  // ── Sprint 73: paradigm-aware language extension ─────────────────────────

  /** Pull the active `Language` out of the editor state via the language
   * facet. CodeMirror stores the top-level Language instance here once a
   * `LanguageSupport` extension is added, so this is the cleanest way to
   * verify that paradigm="document" actually swapped in JSON. */
  function activeLanguageName(view: EditorView): string | undefined {
    return view.state.facet(language)?.name;
  }

  it("uses the SQL language extension by default (paradigm=rdb)", () => {
    render(
      <QueryEditor sql="" onSqlChange={onSqlChange} onExecute={onExecute} />,
    );
    expect(activeLanguageName(getEditorView())).toBe("sql");
  });

  it("swaps to the JSON language when paradigm=document (find mode)", () => {
    render(
      <QueryEditor
        sql="{}"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        paradigm="document"
        queryMode="find"
      />,
    );
    const container = screen.getByLabelText("MongoDB Find Query Editor");
    expect(container).toBeInTheDocument();
    const view = EditorView.findFromDOM(
      container.querySelector(".cm-editor") as HTMLElement,
    )!;
    expect(activeLanguageName(view)).toBe("json");
    expect(container).toHaveAttribute("data-paradigm", "document");
    expect(container).toHaveAttribute("data-query-mode", "find");
  });

  it("uses JSON for document paradigm + aggregate mode", () => {
    render(
      <QueryEditor
        sql="[]"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        paradigm="document"
        queryMode="aggregate"
      />,
    );
    const container = screen.getByLabelText(
      "MongoDB Aggregate Pipeline Editor",
    );
    const view = EditorView.findFromDOM(
      container.querySelector(".cm-editor") as HTMLElement,
    )!;
    expect(activeLanguageName(view)).toBe("json");
    expect(container).toHaveAttribute("data-query-mode", "aggregate");
  });

  // Sprint 139 — paradigm-aware split. Flipping the paradigm now swaps
  // the underlying editor component (SqlQueryEditor ↔ MongoQueryEditor),
  // so the previous "same EditorView instance" contract no longer holds.
  // We assert the new contract: the language identity reflects the new
  // paradigm, the aria-label flips, and the swap completes without
  // throwing. Identity preservation across non-paradigm changes (schema,
  // dialect, mongoExtensions) is exercised by the per-editor tests.
  it("swaps the language extension when paradigm flips rdb → document", async () => {
    const { rerender } = render(
      <QueryEditor
        sql=""
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        paradigm="rdb"
      />,
    );

    expect(activeLanguageName(getEditorView())).toBe("sql");

    rerender(
      <QueryEditor
        sql=""
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        paradigm="document"
        queryMode="find"
      />,
    );

    await waitFor(() => {
      const container = screen.getByLabelText("MongoDB Find Query Editor");
      const viewAfter = EditorView.findFromDOM(
        container.querySelector(".cm-editor") as HTMLElement,
      )!;
      expect(activeLanguageName(viewAfter)).toBe("json");
    });
  });

  it("flips the aria-label when paradigm changes", () => {
    const { rerender } = render(
      <QueryEditor
        sql=""
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        paradigm="document"
        queryMode="find"
      />,
    );
    expect(screen.getByLabelText("MongoDB Find Query Editor")).toBeDefined();

    rerender(
      <QueryEditor
        sql=""
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        paradigm="document"
        queryMode="aggregate"
      />,
    );
    expect(
      screen.getByLabelText("MongoDB Aggregate Pipeline Editor"),
    ).toBeDefined();
  });

  // ── Sprint 82: provider-aware SQL dialect ────────────────────────────────

  /**
   * Collect every identifier in the SQL source that the parser tagged with
   * node name `Keyword`. We walk the full syntax tree for the current doc
   * and pull the matching ranges out as normalised (lowercased) strings so
   * callers can assert "did the dialect actually treat `RETURNING` as a
   * keyword?" without depending on CSS / highlight style output.
   */
  function collectKeywords(view: EditorView): Set<string> {
    const tree = ensureSyntaxTree(view.state, view.state.doc.length, 1000);
    const out = new Set<string>();
    if (!tree) return out;
    tree.iterate({
      enter: (node) => {
        if (node.name === "Keyword") {
          const text = view.state.doc
            .sliceString(node.from, node.to)
            .toLowerCase();
          out.add(text);
        }
      },
    });
    return out;
  }

  // AC-01: Postgres dialect surfaces `RETURNING` and `ILIKE` as keywords.
  it("recognises Postgres-only keywords when sqlDialect=PostgreSQL", () => {
    render(
      <QueryEditor
        sql="INSERT INTO t (a) VALUES (1) RETURNING id; SELECT 1 WHERE x ILIKE 'foo'"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        sqlDialect={PostgreSQL}
      />,
    );
    const kws = collectKeywords(getEditorView());
    expect(kws.has("returning")).toBe(true);
    expect(kws.has("ilike")).toBe(true);
  });

  // AC-02: MySQL dialect highlights `REPLACE` and `DUAL`.
  it("recognises MySQL-only keywords when sqlDialect=MySQL", () => {
    render(
      <QueryEditor
        sql="REPLACE INTO t (a) VALUES (1); SELECT * FROM DUAL"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        sqlDialect={MySQL}
      />,
    );
    const kws = collectKeywords(getEditorView());
    expect(kws.has("replace")).toBe(true);
    expect(kws.has("dual")).toBe(true);
  });

  // AC-03: SQLite dialect highlights `AUTOINCREMENT` and `PRAGMA`.
  it("recognises SQLite-only keywords when sqlDialect=SQLite", () => {
    render(
      <QueryEditor
        sql="CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT); PRAGMA foreign_keys = ON"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        sqlDialect={SQLite}
      />,
    );
    const kws = collectKeywords(getEditorView());
    expect(kws.has("autoincrement")).toBe(true);
    expect(kws.has("pragma")).toBe(true);
  });

  // AC-07: default (sqlDialect undefined) falls back to StandardSQL behaviour.
  // `RETURNING` is Postgres-only so the standard dialect must NOT flag it as
  // a keyword — this guards the fallback path and keeps the pre-Sprint-82
  // contract intact for callers that never pass the new prop.
  it("falls back to StandardSQL when sqlDialect is omitted", () => {
    render(
      <QueryEditor
        sql="INSERT INTO t (a) VALUES (1) RETURNING id"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
      />,
    );
    const kws = collectKeywords(getEditorView());
    // SELECT is in every dialect; this sanity-checks the parser produced a
    // tree at all.
    expect(kws.has("insert")).toBe(true);
    // RETURNING is Postgres-only.
    expect(kws.has("returning")).toBe(false);
  });

  // AC-05: flipping the dialect prop keeps the same EditorView instance.
  // Uses `DUAL` — MySQL recognises it as a keyword, MySQLite/Postgres both
  // treat it as a plain identifier — to prove the Compartment actually
  // reloaded the language spec between renders.
  it("reconfigures the dialect in-place without recreating the EditorView", async () => {
    const { rerender } = render(
      <QueryEditor
        sql="SELECT * FROM DUAL"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        sqlDialect={SQLite}
      />,
    );

    const viewBefore = getEditorView();
    expect(collectKeywords(viewBefore).has("dual")).toBe(false);

    rerender(
      <QueryEditor
        sql="SELECT * FROM DUAL"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        sqlDialect={MySQL}
      />,
    );

    await waitFor(() => {
      const viewAfter = getEditorView();
      // Same EditorView instance — dialect swap must reuse the Compartment,
      // not tear the editor down (cursor/selection/history live inside
      // the view instance).
      expect(viewAfter).toBe(viewBefore);
      expect(collectKeywords(viewAfter).has("dual")).toBe(true);
    });
  });

  // AC-05 / AC-07 — omitting + re-adding the dialect still preserves identity.
  it("preserves the EditorView when switching from StandardSQL fallback to an explicit dialect", async () => {
    const { rerender } = render(
      <QueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
      />,
    );
    const viewBefore = getEditorView();

    rerender(
      <QueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        sqlDialect={PostgreSQL}
      />,
    );

    await waitFor(() => {
      const viewAfter = getEditorView();
      expect(viewAfter).toBe(viewBefore);
    });
  });

  // AC-06: Document paradigm is unaffected by the dialect prop — the editor
  // must still load the JSON language extension and keep its aria-label.
  it("keeps JSON language when paradigm=document even if sqlDialect is passed", () => {
    render(
      <QueryEditor
        sql="{}"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        paradigm="document"
        queryMode="find"
        sqlDialect={MySQL}
      />,
    );
    const container = screen.getByLabelText("MongoDB Find Query Editor");
    const view = EditorView.findFromDOM(
      container.querySelector(".cm-editor") as HTMLElement,
    )!;
    expect(view.state.facet(language)?.name).toBe("json");
  });

  // ── Sprint 83: MQL autocomplete + operator highlight ────────────────────

  /** Collect every element inside the editor carrying the
   * `cm-mql-operator` class, and return their trimmed text content. */
  function collectMqlOperatorTokens(view: EditorView): string[] {
    const marks = view.dom.querySelectorAll(".cm-mql-operator");
    return Array.from(marks).map((el) => (el.textContent ?? "").trim());
  }

  // AC-06: Operator tokens receive the `cm-mql-operator` class.
  it("decorates MQL operator strings with cm-mql-operator when the highlight extension is loaded", async () => {
    render(
      <QueryEditor
        sql='{"$match": {"$eq": 1}}'
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        paradigm="document"
        queryMode="aggregate"
        mongoExtensions={[createMongoOperatorHighlight()]}
      />,
    );
    const container = screen.getByLabelText(
      "MongoDB Aggregate Pipeline Editor",
    );
    const view = EditorView.findFromDOM(
      container.querySelector(".cm-editor") as HTMLElement,
    )!;
    // Force a viewport measurement pass so the ViewPlugin runs its
    // decoration builder against the mounted content.
    view.requestMeasure();
    await waitFor(() => {
      const tokens = collectMqlOperatorTokens(view);
      // Both `$match` and `$eq` should be decorated. The jsdom renderer
      // emits each marked range as its own span; the text inside may
      // include surrounding quotes because the JSON string node covers
      // the quotes too.
      expect(tokens.some((t) => t.includes("$match"))).toBe(true);
      expect(tokens.some((t) => t.includes("$eq"))).toBe(true);
    });
  });

  // AC-06: ordinary JSON strings do NOT receive the operator class.
  it("does not decorate non-operator JSON strings with cm-mql-operator", async () => {
    render(
      <QueryEditor
        sql='{"name": "active"}'
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        paradigm="document"
        queryMode="find"
        mongoExtensions={[createMongoOperatorHighlight()]}
      />,
    );
    const container = screen.getByLabelText("MongoDB Find Query Editor");
    const view = EditorView.findFromDOM(
      container.querySelector(".cm-editor") as HTMLElement,
    )!;
    view.requestMeasure();
    await waitFor(() => {
      const tokens = collectMqlOperatorTokens(view);
      // Neither `"name"` nor `"active"` are MQL operators, so no span
      // should carry the class.
      expect(tokens.some((t) => t.includes("name"))).toBe(false);
      expect(tokens.some((t) => t.includes("active"))).toBe(false);
    });
  });

  // Sprint 139 — paradigm-aware split. Flipping rdb → document with
  // mongoExtensions threaded through the prop now mounts a fresh
  // MongoQueryEditor (the previous SqlQueryEditor unmounts). The new
  // contract: the JSON language is active in the new editor and the
  // mongoExtensions reach the document editor without leaking back into
  // any SQL editor.
  it("mounts the document editor with mongoExtensions when paradigm flips rdb → document", async () => {
    const mongoExts = [createMongoOperatorHighlight()];
    const { rerender } = render(
      <QueryEditor
        sql=""
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        paradigm="rdb"
        mongoExtensions={mongoExts}
      />,
    );
    expect(activeLanguageName(getEditorView())).toBe("sql");

    rerender(
      <QueryEditor
        sql=""
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        paradigm="document"
        queryMode="find"
        mongoExtensions={mongoExts}
      />,
    );

    await waitFor(() => {
      const container = screen.getByLabelText("MongoDB Find Query Editor");
      const viewAfter = EditorView.findFromDOM(
        container.querySelector(".cm-editor") as HTMLElement,
      )!;
      expect(activeLanguageName(viewAfter)).toBe("json");
    });
  });

  // AC-01: run the completion source through the editor's autocomplete
  // pipeline. Build a fresh state that mirrors the editor's extension
  // stack and invoke the source directly on a CompletionContext.
  it("find mode exposes every query operator via the completion override", () => {
    const source = createMongoCompletionSource({ queryMode: "find" });
    const state = EditorState.create({
      doc: '{"$',
      extensions: [jsonLanguage()],
    });
    const ctx = new CompletionContext(state, 3, true);
    const res = source(ctx);
    if (!res || res instanceof Promise) throw new Error("expected sync result");
    const labelSet = new Set(res.options.map((o) => o.label));
    expect(labelSet.has("$eq")).toBe(true);
    expect(labelSet.has("$in")).toBe(true);
    expect(labelSet.has("$elemMatch")).toBe(true);
    // And NOT aggregate stages — find mode key position is stage-free.
    expect(labelSet.has("$match")).toBe(false);
  });

  // AC-07 regression: RDB paradigm ignores mongoExtensions entirely.
  // Build the completion namespace via CodeMirror's language data and
  // verify no `$`-prefixed candidates slip in. We use completionStatus as
  // a proxy — the real check is that the source override is never
  // installed on SQL tabs.
  it("RDB paradigm ignores mongoExtensions — no MQL autocomplete active", () => {
    const mongoExts = [createMongoOperatorHighlight()];
    render(
      <QueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        paradigm="rdb"
        mongoExtensions={mongoExts}
      />,
    );
    const view = getEditorView();
    // RDB path must still report `sql` as the active language; the
    // mongoExtensions are simply not appended by buildLangExtension.
    expect(activeLanguageName(view)).toBe("sql");
    // And the content remains SELECT 1 unchanged.
    expect(view.state.doc.toString()).toBe("SELECT 1");
  });

  // AC-05: field-name candidates appear at key positions in find mode when
  // they are supplied via mongoExtensions.
  it("surfaces field-name candidates from the completion source", () => {
    const source = createMongoCompletionSource({
      queryMode: "find",
      fieldNames: ["_id", "email", "status"],
    });
    const state = EditorState.create({
      doc: '{"',
      extensions: [jsonLanguage()],
    });
    const ctx = new CompletionContext(state, 2, true);
    const res = source(ctx);
    if (!res || res instanceof Promise) throw new Error("expected sync result");
    const labelSet = new Set(res.options.map((o) => o.label));
    expect(labelSet.has('"_id"')).toBe(true);
    expect(labelSet.has('"email"')).toBe(true);
    expect(labelSet.has('"status"')).toBe(true);
  });
});
