import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import RedisCommandEditor from "./RedisCommandEditor";
import {
  expectUndoRevertsEdit,
  getKeymapBindings,
} from "./__tests__/editorHistoryHelpers";

// #1133 — the accessible name now lives on CodeMirror's real `.cm-content`;
// walk up to the editor wrapper (carries data-paradigm) for DOM queries.
function getWrapper(label = "Redis Command Editor"): HTMLElement {
  return screen.getByLabelText(label).closest("[data-paradigm]") as HTMLElement;
}

function getEditorView(): EditorView {
  const cmEditor = getWrapper().querySelector(".cm-editor") as HTMLElement;
  const view = EditorView.findFromDOM(cmEditor);
  if (!view) throw new Error("EditorView not found");
  return view;
}

describe("RedisCommandEditor", () => {
  // #1336 follow-up — every query editor mounts with a unified `view.focus()`
  // so a freshly opened tab is immediately typeable on the real `.cm-content`.
  it("auto-focuses the .cm-content surface on mount (#1336)", async () => {
    const { container } = render(
      <RedisCommandEditor sql="" onSqlChange={vi.fn()} onExecute={vi.fn()} />,
    );
    const cmContent = container.querySelector(".cm-content");
    expect(cmContent).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(cmContent));
  });

  it("renders the Redis command editor surface", () => {
    render(
      <RedisCommandEditor
        sql="GET session:1"
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
      />,
    );

    // #1133 — role/aria on the real `.cm-content`; wrapper keeps data hooks.
    const content = screen.getByLabelText("Redis Command Editor");
    expect(content).toHaveClass("cm-content");
    expect(content).toHaveAttribute("role", "textbox");
    expect(content).toHaveAttribute("aria-multiline", "true");
    const container = getWrapper();
    expect(container).not.toHaveAttribute("role");
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

    // #1133 — Valkey name is on `.cm-content`; wrapper keeps the target hook.
    const content = screen.getByLabelText("Valkey Command Editor");
    expect(content).toHaveAttribute("role", "textbox");
    const container = getWrapper("Valkey Command Editor");
    expect(container).not.toHaveAttribute("role");
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

  // Reason: #1225 — 전 쿼리 에디터 history() 미장착으로 Cmd+Z undo 불가
  // 사용자 보고 (2026-07-03).
  it("reverts an edit via undo (history extension installed) (#1225)", () => {
    render(
      <RedisCommandEditor
        sql="GET k"
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
      />,
    );
    expectUndoRevertsEdit(getEditorView());
  });

  // #1248 — the forwarded ref must resolve to the live EditorView.
  it("forwards a live EditorView to the parent ref (#1248)", () => {
    const ref = createRef<EditorView | null>();
    render(
      <RedisCommandEditor
        ref={ref}
        sql="GET session:1"
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
      />,
    );
    expect(ref.current).toBe(getEditorView());
  });

  it("binds Mod-Enter to execute and Cmd-Shift-Enter to unsupported dry-run", () => {
    const onExecute = vi.fn();
    const onDryRun = vi.fn();
    render(
      <RedisCommandEditor
        sql="TTL session:1"
        onSqlChange={vi.fn()}
        onExecute={onExecute}
        onDryRun={onDryRun}
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
    const dryRunBindings = bindings.filter(
      (entry) => entry.key === "Cmd-Shift-Enter",
    );
    expect(dryRunBindings.length).toBeGreaterThanOrEqual(1);
    for (const binding of dryRunBindings) {
      binding.run?.(view);
    }
    expect(onDryRun).toHaveBeenCalled();
  });
});
