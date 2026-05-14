// Sprint 310 (2026-05-14) — Phase 28 Slice A4 snippet engine lock.
//
// 검증 대상:
// - `convertPlaceholders` 가 `<name>` → `${name}` 변환을 정확히 수행.
//   동일 이름 중복 / mixed text 모두 처리.
// - `insertMongoshSnippet` 가 EditorView 의 cursor 위치에 템플릿을
//   삽입하고, 첫 placeholder 가 selection 으로 잡힌다.
// - 다중 placeholder (find/aggregate) 의 경우 첫 placeholder 만 selection,
//   나머지는 inactive (Tab 으로 이동 가능 — 빌트인 keymap).

import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { autocompletion } from "@codemirror/autocomplete";
import { convertPlaceholders, insertMongoshSnippet } from "./snippetEngine";

function makeView(initialDoc: string, cursor: number): EditorView {
  const state = EditorState.create({
    doc: initialDoc,
    extensions: [autocompletion()],
    selection: { anchor: cursor, head: cursor },
  });
  return new EditorView({ state });
}

describe("convertPlaceholders", () => {
  it("converts a single <name> marker to ${name}", () => {
    expect(convertPlaceholders("db.<collection>.find(<filter>)")).toBe(
      "db.${collection}.find(${filter})",
    );
  });

  it("preserves multiple distinct placeholders in document order", () => {
    expect(
      convertPlaceholders("db.<collection>.distinct(<field>, <filter>)"),
    ).toBe("db.${collection}.distinct(${field}, ${filter})");
  });

  it("converts duplicate placeholder names (each occurrence becomes ${name})", () => {
    // Same name twice — CodeMirror snippet treats same-name placeholders
    // as linked, but document-order Tab cycling still requires each
    // occurrence to be a marker.
    expect(convertPlaceholders("<a> + <b> + <a>")).toBe("${a} + ${b} + ${a}");
  });

  it("leaves a string without placeholders unchanged", () => {
    expect(convertPlaceholders("db.users.estimatedDocumentCount()")).toBe(
      "db.users.estimatedDocumentCount()",
    );
  });

  it("does not interpret malformed <…> (e.g. with spaces) as placeholders", () => {
    expect(convertPlaceholders("a < b > c")).toBe("a < b > c");
  });
});

describe("insertMongoshSnippet", () => {
  it("inserts the template at the cursor with first placeholder selected", () => {
    const view = makeView("", 0);
    insertMongoshSnippet(view, "db.<collection>.find(<filter>)");

    // Document text matches placeholders rendered with their names.
    const doc = view.state.doc.toString();
    expect(doc).toBe("db.collection.find(filter)");

    // First placeholder ("collection") is selected.
    const sel = view.state.selection.main;
    expect(doc.slice(sel.from, sel.to)).toBe("collection");

    view.destroy();
  });

  it("inserts at the current cursor position (not at offset 0) when doc is non-empty", () => {
    // Cursor positioned after `db.users.` so insertion happens mid-text.
    const initial = "// scratch\n";
    const view = makeView(initial, initial.length);
    insertMongoshSnippet(view, "db.<collection>.findOne(<filter>)");

    const doc = view.state.doc.toString();
    expect(doc).toBe(`${initial}db.collection.findOne(filter)`);

    // First placeholder selection.
    const sel = view.state.selection.main;
    expect(doc.slice(sel.from, sel.to)).toBe("collection");

    view.destroy();
  });

  it("does not throw when the template has no placeholders", () => {
    const view = makeView("", 0);
    insertMongoshSnippet(view, "db.users.estimatedDocumentCount()");

    expect(view.state.doc.toString()).toBe("db.users.estimatedDocumentCount()");

    view.destroy();
  });

  it("inserts a wrapped operator fragment with <value> as the first selection (D-08)", () => {
    const view = makeView("", 0);
    insertMongoshSnippet(view, "{ $gt: <value> }");

    const doc = view.state.doc.toString();
    expect(doc).toBe("{ $gt: value }");

    const sel = view.state.selection.main;
    expect(doc.slice(sel.from, sel.to)).toBe("value");

    view.destroy();
  });
});
