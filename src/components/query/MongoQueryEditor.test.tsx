import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { EditorView, keymap } from "@codemirror/view";
import { language } from "@codemirror/language";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { json as jsonLanguage } from "@codemirror/lang-json";
import type { KeyBinding } from "@codemirror/view";
import MongoQueryEditor from "./MongoQueryEditor";
import {
  createMongoCompletionSource,
  createMongoOperatorHighlight,
} from "@lib/mongoAutocomplete";
import { useMongoAutocomplete } from "@hooks/useMongoAutocomplete";

/** Extract all keymap bindings from the editor state. */
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

/**
 * Sprint 139 — MongoQueryEditor unit tests.
 *
 * These guard the structural separation between the document-paradigm
 * editor and the SQL editor. The MongoQueryEditor must:
 *
 *  1. Mount the JSON language extension (NOT SQL).
 *  2. Surface MQL operator candidates through the autocomplete provider
 *     when called via `mongoExtensions` from `useMongoAutocomplete`.
 *  3. NEVER surface SQL keywords (SELECT/FROM/WHERE) as completion
 *     candidates because the editor never imports `useSqlAutocomplete`
 *     and never registers the SQL namespace.
 *  4. Decorate MQL operator strings via the `cm-mql-operator` class.
 *  5. Switch its aria-label between "Find" and "Aggregate" so screen
 *     readers disambiguate the two modes.
 */

function getContainer(label: string) {
  return screen.getByLabelText(label);
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

  // AC-S139-01a — find mode aria-label and JSON language.
  it("renders with find aria-label and JSON language", () => {
    render(
      <MongoQueryEditor
        sql="{}"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        queryMode="find"
        mongoExtensions={[]}
      />,
    );
    const container = getContainer("MongoDB Find Query Editor");
    expect(container).toHaveAttribute("data-paradigm", "document");
    expect(container).toHaveAttribute("data-query-mode", "find");
    const view = getEditorView("MongoDB Find Query Editor");
    expect(view.state.facet(language)?.name).toBe("json");
  });

  // AC-S139-01a — aggregate aria-label.
  it("renders with aggregate aria-label", () => {
    render(
      <MongoQueryEditor
        sql="[]"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        queryMode="aggregate"
        mongoExtensions={[]}
      />,
    );
    const container = getContainer("MongoDB Aggregate Pipeline Editor");
    expect(container).toHaveAttribute("data-query-mode", "aggregate");
    const view = getEditorView("MongoDB Aggregate Pipeline Editor");
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
  // active language facet.
  it("useMongoAutocomplete extensions never bring in the SQL language", () => {
    const { result } = renderHook(() =>
      useMongoAutocomplete({ queryMode: "find" }),
    );
    render(
      <MongoQueryEditor
        sql='{"$match": {}}'
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        queryMode="find"
        mongoExtensions={result.current}
      />,
    );
    const view = getEditorView("MongoDB Find Query Editor");
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
        queryMode="aggregate"
        mongoExtensions={[createMongoOperatorHighlight()]}
      />,
    );
    const view = getEditorView("MongoDB Aggregate Pipeline Editor");
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
        queryMode="find"
        mongoExtensions={[]}
      />,
    );
    const view = getEditorView("MongoDB Find Query Editor");
    const bindings = getKeymapBindings(view).filter(
      (b) => b.key === "Mod-Enter",
    );
    for (const b of bindings) {
      if (typeof b.run === "function") b.run(view);
    }
    expect(localOnExecute).toHaveBeenCalled();
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
        queryMode="find"
        mongoExtensions={initial}
      />,
    );
    const viewBefore = getEditorView("MongoDB Find Query Editor");

    const next = [createMongoOperatorHighlight()];
    rerender(
      <MongoQueryEditor
        sql="{}"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        queryMode="find"
        mongoExtensions={next}
      />,
    );

    await waitFor(() => {
      const viewAfter = getEditorView("MongoDB Find Query Editor");
      expect(viewAfter).toBe(viewBefore);
    });
  });
});
