import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { act, waitFor } from "@testing-library/react";
import { expect, type Mock } from "vitest";
import { getKeymapBindings } from "./editorHistoryHelpers";

// #2509 — MongoQueryEditor 와 SearchQueryEditor 는 자동완성 후보를 caller 가
// prop 으로 넣어 준다 (`useMongoAutocomplete` / `useSearchAutocomplete` 가
// `autocompletion({ override: [...] })` 를 넘긴다). 아래는 그것과 같은 모양이면서
// 언제나 후보가 하나 있는 source 라, 팝업이 열리는지가 paradigm 마다 다른 문법에
// 좌우되지 않는다. SqlQueryEditor 와 RedisCommandEditor 는 자기 source 를 직접
// 들고 있으므로 이 확장이 필요하지 않다.
export const alwaysMatchingCompletion: Extension = autocompletion({
  override: [
    (context) => ({ from: context.pos, options: [{ label: "candidate" }] }),
  ],
});

const POPUP_SELECTOR = ".cm-tooltip-autocomplete";

/**
 * Reason: #2509 — 쿼리를 실행해도 자동완성 팝업이 닫히지 않아서, 사용자가 결과를
 * 보려는 순간 팝업이 결과 그리드를 덮었고 E2E 에서는 `.cm-content` 의 클릭 지점을
 * 가렸다 (`e2e/smoke/_helpers.ts` 의 `clearSqlEditorClickPoint`).
 *
 * 단언은 팝업이 사라진다는 성질에 건다. CodeMirror 의 팝업 닫기 명령이 불렸다는
 * 사실을 스파이로 재면, 그 명령이 아무 일도 하지 않게 바뀌어도 green 이 되기
 * 때문이다.
 *
 * RED (실행 트리거가 팝업을 닫지 않을 때): 팝업 element 가 그대로 남아서 두 번째
 * `waitFor` 가 타임아웃한다.
 * GREEN: 실행 트리거가 팝업을 닫아서 그 element 가 사라진다.
 */
export async function expectExecuteClosesCompletionPopup(
  view: EditorView,
  onExecute: Mock,
): Promise<void> {
  act(() => {
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    startCompletion(view);
  });
  await waitFor(() => {
    expect(view.dom.querySelectorAll(POPUP_SELECTOR)).toHaveLength(1);
  });

  // CodeMirror 는 우선순위 순서로 binding 을 돌리다가 true 를 낸 첫 binding 에서
  // 멈춘다. 에디터 넷이 자기 Mod-Enter 를 defaultKeymap 앞에 두는 이유가 그것이고,
  // 그 하나만 부르면 문서를 고쳐서 팝업을 스스로 닫아 버리는 default binding 이
  // 단언에 섞이지 않는다. 아래 `onExecute` 단언이 실제로 에디터 자신의 binding 을
  // 불렀다는 것을 확인해 준다.
  const executeBinding = getKeymapBindings(view).find(
    (binding) => binding.key === "Mod-Enter",
  );
  act(() => {
    expect(executeBinding?.run?.(view)).toBe(true);
  });
  expect(onExecute).toHaveBeenCalledTimes(1);

  await waitFor(() => {
    expect(view.dom.querySelectorAll(POPUP_SELECTOR)).toHaveLength(0);
  });
}
