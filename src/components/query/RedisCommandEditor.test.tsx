import { describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { EditorView, keymap, type KeyBinding } from "@codemirror/view";
import RedisCommandEditor from "./RedisCommandEditor";

function getEditorView(): EditorView {
  const container = screen.getByLabelText("Redis Command Editor");
  const cmEditor = container.querySelector(".cm-editor") as HTMLElement;
  const view = EditorView.findFromDOM(cmEditor);
  if (!view) throw new Error("EditorView not found");
  return view;
}

function getKeymapBindings(view: EditorView): KeyBinding[] {
  const bindings: KeyBinding[] = [];
  for (const set of view.state.facet(keymap)) {
    if (Array.isArray(set)) bindings.push(...set);
  }
  return bindings;
}

describe("RedisCommandEditor", () => {
  it("renders the Redis command editor surface", () => {
    render(
      <RedisCommandEditor
        sql="GET session:1"
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
      />,
    );

    const container = screen.getByLabelText("Redis Command Editor");
    expect(container).toHaveAttribute("role", "textbox");
    expect(container).toHaveAttribute("aria-multiline", "true");
    expect(container).toHaveAttribute("data-paradigm", "kv");
    expect(container).toHaveAttribute("data-command-target", "redis");
    expect(container.querySelector(".cm-content")?.textContent).toContain(
      "GET session:1",
    );
  });

  it("labels the Valkey command editor target", () => {
    render(
      <RedisCommandEditor
        sql="GET session:1"
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
        redisCommandTarget="valkey"
      />,
    );

    const container = screen.getByLabelText("Valkey Command Editor");
    expect(container).toHaveAttribute("role", "textbox");
    expect(container).toHaveAttribute("data-command-target", "valkey");
  });

  it("calls onSqlChange when command text changes", () => {
    const onSqlChange = vi.fn();
    render(
      <RedisCommandEditor
        sql="GET session:1"
        onSqlChange={onSqlChange}
        onExecute={vi.fn()}
      />,
    );

    act(() => {
      getEditorView().dispatch({
        changes: { from: 0, to: 3, insert: "TTL" },
      });
    });

    expect(onSqlChange).toHaveBeenCalledWith("TTL session:1");
  });

  it("preserves cursor position across external command text sync", () => {
    const { rerender } = render(
      <RedisCommandEditor
        sql="GET profile:1"
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
      />,
    );
    const view = getEditorView();
    const cursorAfterDeletedChar = "GET profil".length;
    act(() => {
      view.dispatch({
        selection: { anchor: cursorAfterDeletedChar },
      });
    });

    rerender(
      <RedisCommandEditor
        sql="GET profie:1"
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
      />,
    );

    expect(getEditorView().state.doc.toString()).toBe("GET profie:1");
    expect(getEditorView().state.selection.main.head).toBe(
      cursorAfterDeletedChar - 1,
    );
  });

  it("binds Mod-Enter to execute without binding dry-run", () => {
    const onExecute = vi.fn();
    render(
      <RedisCommandEditor
        sql="TTL session:1"
        onSqlChange={vi.fn()}
        onExecute={onExecute}
        onDryRun={vi.fn()}
      />,
    );

    const view = getEditorView();
    const bindings = getKeymapBindings(view);
    for (const binding of bindings.filter(
      (entry) => entry.key === "Mod-Enter",
    )) {
      binding.run?.(view);
    }

    expect(onExecute).toHaveBeenCalled();
    expect(bindings.some((entry) => entry.key === "Cmd-Shift-Enter")).toBe(
      false,
    );
  });
});
