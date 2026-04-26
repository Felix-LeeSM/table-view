import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { EditorView, keymap } from "@codemirror/view";
import { ensureSyntaxTree, language } from "@codemirror/language";
import { MySQL, PostgreSQL, SQLite } from "@codemirror/lang-sql";
import type { KeyBinding } from "@codemirror/view";
import SqlQueryEditor from "./SqlQueryEditor";

/**
 * Sprint 139 — SqlQueryEditor unit tests.
 *
 * Mirrors the slice of QueryEditor tests that exercise SQL behaviour:
 * dialect-specific keyword recognition, language identity, ariaLabel,
 * Mod-Enter execute, schemaNamespace reconfigure preserves the EditorView.
 *
 * The structural firewall here is JSON: this editor must NEVER swap to
 * the JSON language. We assert that explicitly.
 */

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

function getKeymapBindings(view: EditorView): KeyBinding[] {
  const bindings: KeyBinding[] = [];
  const facetValues = view.state.facet(keymap);
  for (const set of facetValues) {
    if (Array.isArray(set)) {
      for (const binding of set) bindings.push(binding);
    }
  }
  return bindings;
}

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

describe("SqlQueryEditor (Sprint 139)", () => {
  const onSqlChange = vi.fn();
  const onExecute = vi.fn();

  beforeEach(() => {
    onSqlChange.mockReset();
    onExecute.mockReset();
  });

  // AC-S139-02 — aria-label and SQL language facet.
  it("renders with role=textbox + aria-label=SQL Query Editor", () => {
    render(
      <SqlQueryEditor sql="" onSqlChange={onSqlChange} onExecute={onExecute} />,
    );
    const container = getContainer();
    expect(container).toHaveAttribute("role", "textbox");
    expect(container).toHaveAttribute("data-paradigm", "rdb");
    expect(container).toHaveAttribute("data-query-mode", "sql");
  });

  it("uses the SQL language extension (default StandardSQL)", () => {
    render(
      <SqlQueryEditor sql="" onSqlChange={onSqlChange} onExecute={onExecute} />,
    );
    expect(getEditorView().state.facet(language)?.name).toBe("sql");
  });

  it("never swaps to the JSON language (structural firewall)", () => {
    render(
      <SqlQueryEditor
        sql='{"x": 1}'
        onSqlChange={onSqlChange}
        onExecute={onExecute}
      />,
    );
    expect(getEditorView().state.facet(language)?.name).toBe("sql");
    expect(getEditorView().state.facet(language)?.name).not.toBe("json");
  });

  // AC-S139-02 — Postgres dialect keywords.
  it("recognises Postgres-only keywords when sqlDialect=PostgreSQL", () => {
    render(
      <SqlQueryEditor
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

  // AC-S139-02 — MySQL dialect keywords.
  it("recognises MySQL-only keywords when sqlDialect=MySQL", () => {
    render(
      <SqlQueryEditor
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

  // AC-S139-02 — SQLite dialect keywords.
  it("recognises SQLite-only keywords when sqlDialect=SQLite", () => {
    render(
      <SqlQueryEditor
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

  // AC-S139-05 — cross-dialect contamination guard. Postgres dialect
  // does NOT highlight DUAL (MySQL-only) as a keyword.
  it("does not flag MySQL-only DUAL as a keyword under PG dialect", () => {
    render(
      <SqlQueryEditor
        sql="SELECT * FROM DUAL"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        sqlDialect={PostgreSQL}
      />,
    );
    const kws = collectKeywords(getEditorView());
    expect(kws.has("dual")).toBe(false);
  });

  // Reconfigure-in-place: dialect prop change keeps the same EditorView.
  it("reconfigures the dialect in-place without recreating the EditorView", async () => {
    const { rerender } = render(
      <SqlQueryEditor
        sql="SELECT * FROM DUAL"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        sqlDialect={SQLite}
      />,
    );
    const viewBefore = getEditorView();
    expect(collectKeywords(viewBefore).has("dual")).toBe(false);

    rerender(
      <SqlQueryEditor
        sql="SELECT * FROM DUAL"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        sqlDialect={MySQL}
      />,
    );

    await waitFor(() => {
      const viewAfter = getEditorView();
      expect(viewAfter).toBe(viewBefore);
      expect(collectKeywords(viewAfter).has("dual")).toBe(true);
    });
  });

  // Mod-Enter onExecute.
  it("fires onExecute via Mod-Enter binding", () => {
    const localOnExecute = vi.fn();
    render(
      <SqlQueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={localOnExecute}
      />,
    );
    const view = getEditorView();
    const bindings = getKeymapBindings(view).filter(
      (b) => b.key === "Mod-Enter",
    );
    for (const b of bindings) {
      if (typeof b.run === "function") b.run(view);
    }
    expect(localOnExecute).toHaveBeenCalled();
  });

  // External sql prop syncs into editor.
  it("syncs external sql prop changes into the editor document", async () => {
    const { rerender } = render(
      <SqlQueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
      />,
    );

    rerender(
      <SqlQueryEditor
        sql="SELECT * FROM users"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
      />,
    );

    await waitFor(() => {
      const content = getContainer().querySelector(".cm-content");
      expect(content?.textContent).toContain("SELECT * FROM users");
    });
  });

  // schemaNamespace reconfigure preserves the EditorView.
  it("keeps the editor alive when schemaNamespace identity changes", () => {
    const { rerender } = render(
      <SqlQueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        schemaNamespace={undefined}
      />,
    );
    const viewBefore = getEditorView();

    rerender(
      <SqlQueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        schemaNamespace={{ users: {} } as any}
      />,
    );

    const viewAfter = getEditorView();
    expect(viewAfter).toBe(viewBefore);
    expect(viewAfter.state.doc.toString()).toBe("SELECT 1");
  });
});
