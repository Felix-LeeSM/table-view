import { act } from "@testing-library/react";
import { undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { expect } from "vitest";

// Reason: #1225 — 전 쿼리 에디터(sql/mongo/redis/search)는 CodeMirror
// history() + historyKeymap 을 장착해야 Cmd+Z undo 가 동작한다. 이 헬퍼는
// 네 에디터 회귀 테스트가 동일한 undo 계약을 검증하도록 공유한다
// (사용자 보고 2026-07-03).
//
// RED: history() 미장착 시 `undo` 는 no-op → doc 이 그대로라 revert 단언 실패.
// GREEN: history 장착 시 삽입이 되돌려져 `before` 로 복원.
export function expectUndoRevertsEdit(view: EditorView): void {
  const before = view.state.doc.toString();
  const appended = `${before} X`;

  act(() => {
    view.dispatch({ changes: { from: view.state.doc.length, insert: " X" } });
  });
  expect(view.state.doc.toString()).toBe(appended);

  act(() => {
    undo(view);
  });
  expect(view.state.doc.toString()).toBe(before);
}
