import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@lib/runtime/toast", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
    clear: vi.fn(),
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { toast } from "@lib/runtime/toast";
import {
  useSnippetsStore,
  __resetSnippetCounterForTests,
} from "./snippetsStore";

const invokeMock = vi.mocked(invoke);
const toastErrorMock = vi.mocked(toast.error);

describe("snippetsStore", () => {
  beforeEach(() => {
    useSnippetsStore.setState({ snippets: [] });
    __resetSnippetCounterForTests();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    toastErrorMock.mockReset();
  });

  it("addSnippet appends a snippet and persists the full list via IPC", () => {
    useSnippetsStore.getState().addSnippet("mine", "SELECT * FROM {{t}}");
    const { snippets } = useSnippetsStore.getState();
    expect(snippets).toHaveLength(1);
    expect(snippets[0]).toMatchObject({
      id: "snip-1",
      name: "mine",
      body: "SELECT * FROM {{t}}",
    });
    expect(invokeMock).toHaveBeenCalledWith("persist_snippets", {
      snippets: [
        expect.objectContaining({ id: "snip-1", name: "mine", sortOrder: 0 }),
      ],
    });
  });

  it("removeSnippet drops the id and persists the shrunken list", () => {
    const store = useSnippetsStore.getState();
    store.addSnippet("a", "SELECT 1");
    store.addSnippet("b", "SELECT 2");
    invokeMock.mockClear();
    useSnippetsStore.getState().removeSnippet("snip-1");
    const { snippets } = useSnippetsStore.getState();
    expect(snippets.map((s) => s.id)).toEqual(["snip-2"]);
    expect(invokeMock).toHaveBeenCalledWith("persist_snippets", {
      snippets: [expect.objectContaining({ id: "snip-2", sortOrder: 0 })],
    });
  });

  it("toasts when a persist write rejects (SQLite is the SOT — silent loss guard)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("disk full"));
    useSnippetsStore.getState().addSnippet("x", "SELECT 1");
    // Fire-and-forget rejection settles on the microtask queue.
    await Promise.resolve();
    await Promise.resolve();
    expect(toastErrorMock).toHaveBeenCalled();
  });

  it("loadPersistedSnippets hydrates from list_snippets and ratchets the id counter", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: "snip-7",
        name: "seeded",
        body: "SELECT 42",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    await useSnippetsStore.getState().loadPersistedSnippets();
    expect(useSnippetsStore.getState().snippets).toHaveLength(1);
    // The counter must skip past seeded ids so new snippets don't collide.
    invokeMock.mockResolvedValue(undefined);
    useSnippetsStore.getState().addSnippet("new", "SELECT 1");
    const ids = useSnippetsStore.getState().snippets.map((s) => s.id);
    expect(ids).toContain("snip-8");
  });

  it("loadPersistedSnippets stays empty when the IPC read fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("no backend"));
    await useSnippetsStore.getState().loadPersistedSnippets();
    expect(useSnippetsStore.getState().snippets).toEqual([]);
  });
});
