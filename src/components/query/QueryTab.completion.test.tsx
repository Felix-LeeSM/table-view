// #2509 — `completion` axis. 툴바 Run 버튼을 다루는 `QueryTab.toolbar.test.tsx`
// 는 `./SqlQueryEditor` 를 DOM testbed 로 `vi.mock` 하고, 그 대체는 모듈 단위라
// 그 파일 안에서는 진짜 CodeMirror 팝업을 띄울 수 없다. 그래서 이 축을 따로
// 두고 에디터를 실물로 마운트한다.

import { EditorView } from "@codemirror/view";
import { useHistorySettingsStore } from "@stores/historySettingsStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  expectCompletionPopupClosed,
  openCompletionPopup,
} from "./__tests__/editorCompletionHelpers";
import {
  MOCK_RESULT,
  makeQueryTab,
  mockAggregateDocuments,
  mockCancelQuery,
  mockExecuteQuery,
  mockFindDocuments,
  mockVerifyActiveDb,
  resetQueryTabStores,
} from "./__tests__/queryTabTestHelpers";
import QueryTab from "./QueryTab";

beforeEach(() => {
  setupTauriMock({
    executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
    cancelQuery: (...args: unknown[]) => mockCancelQuery(...args),
    findDocuments: (...args: unknown[]) => mockFindDocuments(...args),
    aggregateDocuments: (...args: unknown[]) => mockAggregateDocuments(...args),
  });
});

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: (...args: unknown[]) => mockVerifyActiveDb(...args),
}));

vi.mock("./QueryResultGrid", () => ({
  default: () => <div data-testid="mock-result" />,
}));

// 스키마 후보는 이 축이 안 쓴다. 팝업은 SqlQueryEditor 자신의
// `autocompletion()` + SQL 언어의 키워드 source 가 띄운다.
vi.mock("@hooks/useSqlAutocomplete", () => ({
  useSqlAutocomplete: () => ({}),
}));

function getEditorView(container: HTMLElement): EditorView {
  const cmEditor = container.querySelector(".cm-editor");
  if (!cmEditor) throw new Error(".cm-editor not found");
  const view = EditorView.findFromDOM(cmEditor as HTMLElement);
  if (!view) throw new Error("EditorView not found");
  return view;
}

describe("QueryTab — autocomplete popup on execute (#2509)", () => {
  beforeEach(() => {
    resetQueryTabStores();
    // 실행이 기록을 남기면 backend 없는 jsdom 에서 background write 가 거절돼
    // 단언과 무관한 stderr 가 쌓인다.
    useHistorySettingsStore.setState({ queryHistoryEnabled: false });
  });

  // 사용자 시퀀스: 에디터에 타이핑하면 자동완성 팝업이 뜬다 → 마우스로 툴바의
  // Run 버튼을 누른다 → **팝업이 사라져서 결과 그리드를 가리지 않는다** ←
  // lock 대상. 단언을 팝업 element 의 부재에 거는 이유는, 닫기 명령이 불렸다는
  // 사실을 스파이로 재면 그 명령이 아무 일도 하지 않게 바뀌어도 green 이 되기
  // 때문이다.
  //
  // 이 경로가 값을 지는 이유는 E2E 가 단축키가 아니라 이 버튼을 클릭하기
  // 때문이다 (`e2e/smoke/_helpers.ts` 의 `runQuery` 가
  // `[aria-label="Run query"]` 를 누른다).
  it("closes the autocomplete popup when the toolbar Run button executes", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab({ sql: "SEL" });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    const { container } = render(<QueryTab tab={tab} />);

    const view = getEditorView(container);
    await openCompletionPopup(view);

    await act(async () => {
      screen.getByLabelText("Run query").click();
    });
    // 클릭이 실제로 실행 경로에 닿았다는 확인 — 버튼이 아무 일도 안 해서
    // 팝업이 남았다면 아래 단언이 아니라 이 줄이 먼저 실패해야 한다.
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);

    await expectCompletionPopupClosed(view);
  });
});
