import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { EditorView, keymap } from "@codemirror/view";
import type { KeyBinding } from "@codemirror/view";
import QueryEditor from "./QueryEditor";

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

  it("recreates the editor when schemaNamespace changes", () => {
    const { rerender } = render(
      <QueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        schemaNamespace={undefined}
      />,
    );

    // Change schemaNamespace — triggers editor recreation via useEffect
    rerender(
      <QueryEditor
        sql="SELECT 1"
        onSqlChange={onSqlChange}
        onExecute={onExecute}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        schemaNamespace={{} as any}
      />,
    );

    const container = getContainer();
    expect(container).toBeInTheDocument();
    const content = container.querySelector(".cm-content");
    expect(content?.textContent).toContain("SELECT 1");
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
});
