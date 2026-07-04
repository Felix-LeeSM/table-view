import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRef } from "react";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { language } from "@codemirror/language";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { json as jsonLanguage } from "@codemirror/lang-json";
import MongoQueryEditor from "./MongoQueryEditor";
import {
  expectUndoRevertsEdit,
  getKeymapBindings,
} from "./__tests__/editorHistoryHelpers";
import {
  createMongoCompletionSource,
  createMongoOperatorHighlight,
  useMongoAutocomplete,
} from "@features/completion";

/**
 * Sprint 139 — MongoQueryEditor unit tests.
 *
 * Sprint 309 update: the editor is now a single mongosh surface. The
 * `queryMode` prop is gone, the wrapper aria-label is the single string
 * `"MongoDB Query Editor"`, and `data-query-mode` is no longer set. The
 * old "Find aria-label" / "Aggregate aria-label" cases collapse into one
 * "single aria-label" assertion. The structural guards below remain:
 *
 *  1. Mount the JSON language extension (NOT SQL).
 *  2. Surface MQL operator candidates through the autocomplete provider
 *     when called via `mongoExtensions` from `useMongoAutocomplete`.
 *  3. NEVER surface SQL keywords (SELECT/FROM/WHERE) as completion
 *     candidates because the editor never imports `useSqlAutocomplete`
 *     and never registers the SQL namespace.
 *  4. Decorate MQL operator strings via the `cm-mql-operator` class.
 */

function getContainer(label: string) {
  // #1133 — the accessible name now lives on CodeMirror's real `.cm-content`;
  // walk up to the editor wrapper (carries data-paradigm) for DOM queries.
  return screen.getByLabelText(label).closest("[data-paradigm]") as HTMLElement;
}

function getEditorView(label: string): EditorView {
  const container = getContainer(label);
  const cmEditor = container.querySelector(".cm-editor") as HTMLElement;
  const view = EditorView.findFromDOM(cmEditor);
  if (!view) throw new Error("EditorView not found");
  return view;
}

describe("MongoQueryEditor (Sprint 139)", () => {
  const onSqlChange = vi.fn();
  const onExecute = vi.fn();

  beforeEach(() => {
    onSqlChange.mockReset();
    onExecute.mockReset();
  });

  // Sprint 309 — single aria-label `"MongoDB Query Editor"`, no
  // `data-query-mode`, JSON language. Combines the old find/aggregate
  // aria-label assertions into one.
  it("renders with the unified MongoDB aria-label and JSON language (Sprint 309)", () => {
    render(
      <MongoQueryEditor
        sql="{}"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        mongoExtensions={[]}
      />,
    );
    const container = getContainer("MongoDB Query Editor");
    expect(container).toHaveAttribute("data-paradigm", "document");
    expect(container).not.toHaveAttribute("data-query-mode");
    const view = getEditorView("MongoDB Query Editor");
    expect(view.state.facet(language)?.name).toBe("json");
  });

  // AC-S139-01b — autocomplete source from useMongoAutocomplete surfaces
  // MQL operators (driven by completion source, not the editor itself).
  it("find-mode completion source includes MQL operators ($eq, $in, $elemMatch)", () => {
    const source = createMongoCompletionSource({ queryMode: "find" });
    const state = EditorState.create({
      doc: '{"$',
      extensions: [jsonLanguage()],
    });
    const ctx = new CompletionContext(state, 3, true);
    const res = source(ctx);
    if (!res || res instanceof Promise) throw new Error("expected sync result");
    const labels = new Set(res.options.map((o) => o.label));
    expect(labels.has("$eq")).toBe(true);
    expect(labels.has("$in")).toBe(true);
    expect(labels.has("$elemMatch")).toBe(true);
  });

  // AC-S139-01b — aggregate-mode completion source includes pipeline stages.
  it("aggregate-mode completion source includes pipeline stages ($match, $group, $lookup)", () => {
    const source = createMongoCompletionSource({ queryMode: "aggregate" });
    const state = EditorState.create({
      doc: '[{"$',
      extensions: [jsonLanguage()],
    });
    const ctx = new CompletionContext(state, 4, true);
    const res = source(ctx);
    if (!res || res instanceof Promise) throw new Error("expected sync result");
    const labels = new Set(res.options.map((o) => o.label));
    expect(labels.has("$match")).toBe(true);
    expect(labels.has("$group")).toBe(true);
    expect(labels.has("$lookup")).toBe(true);
    expect(labels.has("$project")).toBe(true);
  });

  // AC-S139-01b (cross-contamination guard) — completion source NEVER
  // surfaces SQL keywords. This is the structural firewall: even if the
  // upstream caller accidentally piped `useSqlAutocomplete` results in,
  // the Mongo source itself only exposes `$`-prefixed operators + field
  // names + type tags.
  it("completion source NEVER includes SQL keywords (SELECT, FROM, WHERE)", () => {
    for (const queryMode of ["find", "aggregate"] as const) {
      const source = createMongoCompletionSource({ queryMode });
      const state = EditorState.create({
        doc: queryMode === "find" ? '{"$' : '[{"$',
        extensions: [jsonLanguage()],
      });
      const ctx = new CompletionContext(
        state,
        queryMode === "find" ? 3 : 4,
        true,
      );
      const res = source(ctx);
      if (!res || res instanceof Promise) {
        throw new Error("expected sync result");
      }
      const labels = new Set(res.options.map((o) => o.label));
      expect(labels.has("SELECT")).toBe(false);
      expect(labels.has("FROM")).toBe(false);
      expect(labels.has("WHERE")).toBe(false);
      expect(labels.has("RETURNING")).toBe(false);
      expect(labels.has("AUTO_INCREMENT")).toBe(false);
      expect(labels.has("PRAGMA")).toBe(false);
    }
  });

  // AC-S139-04 — `useMongoAutocomplete` returns extensions that, when
  // installed in the editor, never load an SQL grammar. Verifies via the
  // active language facet. Sprint 309 — hook called without arguments.
  it("useMongoAutocomplete extensions never bring in the SQL language", () => {
    const { result } = renderHook(() => useMongoAutocomplete());
    render(
      <MongoQueryEditor
        sql='{"$match": {}}'
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        mongoExtensions={result.current}
      />,
    );
    const view = getEditorView("MongoDB Query Editor");
    // Active language must be JSON, never SQL.
    expect(view.state.facet(language)?.name).toBe("json");
    expect(view.state.facet(language)?.name).not.toBe("sql");
  });

  // AC-S139-01c — operator highlight extension decorates MQL operators.
  it("decorates MQL operator strings with cm-mql-operator", async () => {
    render(
      <MongoQueryEditor
        sql='{"$match": {"$eq": 1}}'
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        mongoExtensions={[createMongoOperatorHighlight()]}
      />,
    );
    const view = getEditorView("MongoDB Query Editor");
    view.requestMeasure();
    await waitFor(() => {
      const marks = view.dom.querySelectorAll(".cm-mql-operator");
      const tokens = Array.from(marks).map((el) =>
        (el.textContent ?? "").trim(),
      );
      expect(tokens.some((t) => t.includes("$match"))).toBe(true);
      expect(tokens.some((t) => t.includes("$eq"))).toBe(true);
    });
  });

  // Mod-Enter onExecute callback fires.
  it("fires onExecute via Mod-Enter binding", () => {
    const localOnExecute = vi.fn();
    render(
      <MongoQueryEditor
        sql="{}"
        onSqlChange={onSqlChange}
        onExecute={localOnExecute}
        mongoExtensions={[]}
      />,
    );
    const view = getEditorView("MongoDB Query Editor");
    const bindings = getKeymapBindings(view).filter(
      (b) => b.key === "Mod-Enter",
    );
    for (const b of bindings) {
      if (typeof b.run === "function") b.run(view);
    }
    expect(localOnExecute).toHaveBeenCalled();
  });

  it("fires the unsupported dry-run handler via Cmd-Shift-Enter binding", () => {
    const localOnExecute = vi.fn();
    const localOnDryRun = vi.fn();
    render(
      <MongoQueryEditor
        sql="db.users.find({})"
        onSqlChange={onSqlChange}
        onExecute={localOnExecute}
        onDryRun={localOnDryRun}
        mongoExtensions={[]}
      />,
    );
    const view = getEditorView("MongoDB Query Editor");
    const bindings = getKeymapBindings(view).filter(
      (binding) => binding.key === "Cmd-Shift-Enter",
    );
    expect(bindings.length).toBeGreaterThanOrEqual(1);
    for (const binding of bindings) {
      binding.run?.(view);
    }
    expect(localOnDryRun).toHaveBeenCalled();
    expect(localOnExecute).not.toHaveBeenCalled();
  });

  // Reason: #1225 — 전 쿼리 에디터 history() 미장착으로 Cmd+Z undo 불가
  // 사용자 보고 (2026-07-03).
  it("reverts an edit via undo (history extension installed) (#1225)", () => {
    render(
      <MongoQueryEditor
        sql="{}"
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
        mongoExtensions={[]}
      />,
    );
    expectUndoRevertsEdit(getEditorView("MongoDB Query Editor"));
  });

  // #1248 — the forwarded ref must resolve to the live EditorView.
  it("forwards a live EditorView to the parent ref (#1248)", () => {
    const ref = createRef<EditorView | null>();
    render(
      <MongoQueryEditor
        ref={ref}
        sql="{}"
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
        mongoExtensions={[]}
      />,
    );
    expect(ref.current).toBe(getEditorView("MongoDB Query Editor"));
  });

  it("preserves cursor position across external query text sync", () => {
    const { rerender } = render(
      <MongoQueryEditor
        sql='{ "profile": 1 }'
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        mongoExtensions={[]}
      />,
    );
    const view = getEditorView("MongoDB Query Editor");
    const cursorAfterDeletedChar = '{ "profil'.length;
    act(() => {
      view.dispatch({ selection: { anchor: cursorAfterDeletedChar } });
    });

    rerender(
      <MongoQueryEditor
        sql='{ "profie": 1 }'
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        mongoExtensions={[]}
      />,
    );

    expect(getEditorView("MongoDB Query Editor").state.doc.toString()).toBe(
      '{ "profie": 1 }',
    );
    expect(
      getEditorView("MongoDB Query Editor").state.selection.main.head,
    ).toBe(cursorAfterDeletedChar - 1);
  });

  // Reconfigure-in-place: same EditorView instance survives mongoExtensions
  // identity change.
  it("reuses the EditorView when mongoExtensions identity changes", async () => {
    const initial = [createMongoOperatorHighlight()];
    const { rerender } = render(
      <MongoQueryEditor
        sql="{}"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        mongoExtensions={initial}
      />,
    );
    const viewBefore = getEditorView("MongoDB Query Editor");

    const next = [createMongoOperatorHighlight()];
    rerender(
      <MongoQueryEditor
        sql="{}"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        mongoExtensions={next}
      />,
    );

    await waitFor(() => {
      const viewAfter = getEditorView("MongoDB Query Editor");
      expect(viewAfter).toBe(viewBefore);
    });
  });
});
