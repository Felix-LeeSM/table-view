// Sprint 334 (2026-05-15) — Slice L live wire. CollectionDdlDialog 가
// create / rename / drop 3 모드 모두 실제 IPC 를 dispatch 하고 성공시
// onClose / onSuccess 를 호출한다. JSON options 파싱 + required field
// 가드도 같이 가드.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CollectionDdlDialog } from "./CollectionDdlDialog";

const createCollectionMock = vi.fn();
const renameCollectionMock = vi.fn();
const dropCollectionMock = vi.fn();
beforeEach(() => {
  setupTauriMock({
    createCollection: (...args: unknown[]) => createCollectionMock(...args),
    renameCollection: (...args: unknown[]) => renameCollectionMock(...args),
    dropCollection: (...args: unknown[]) => dropCollectionMock(...args),
  });
});

describe("CollectionDdlDialog (Sprint 334 — Slice L live wire)", () => {
  beforeEach(() => {
    createCollectionMock.mockReset();
    renameCollectionMock.mockReset();
    dropCollectionMock.mockReset();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <CollectionDdlDialog
        open={false}
        mode="create"
        connectionId="conn-mongo"
        database="app"
        onClose={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("dispatches create with the parsed options JSON", async () => {
    createCollectionMock.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(
      <CollectionDdlDialog
        open
        mode="create"
        connectionId="conn-mongo"
        database="app"
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByTestId("collection-ddl-name"), {
      target: { value: "events" },
    });
    fireEvent.change(screen.getByTestId("collection-ddl-options"), {
      target: { value: '{"capped":true,"size":1048576}' },
    });

    await user.click(screen.getByTestId("collection-ddl-save"));

    await waitFor(() => {
      expect(createCollectionMock).toHaveBeenCalledWith(
        "conn-mongo",
        "app",
        "events",
        { capped: true, size: 1048576 },
      );
    });
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("blocks create when the options JSON is invalid", async () => {
    const user = userEvent.setup();
    render(
      <CollectionDdlDialog
        open
        mode="create"
        connectionId="conn-mongo"
        database="app"
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId("collection-ddl-name"), {
      target: { value: "events" },
    });
    fireEvent.change(screen.getByTestId("collection-ddl-options"), {
      target: { value: "{not json" },
    });

    await user.click(screen.getByTestId("collection-ddl-save"));

    expect(await screen.findByTestId("collection-ddl-error")).toHaveTextContent(
      /invalid options json/i,
    );
    expect(createCollectionMock).not.toHaveBeenCalled();
  });

  it("dispatches rename with from / to arguments", async () => {
    renameCollectionMock.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <CollectionDdlDialog
        open
        mode="rename"
        connectionId="conn-mongo"
        database="app"
        collection="users"
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByTestId("collection-ddl-rename-to"), {
      target: { value: "users_v2" },
    });
    await user.click(screen.getByTestId("collection-ddl-save"));

    await waitFor(() => {
      expect(renameCollectionMock).toHaveBeenCalledWith(
        "conn-mongo",
        "app",
        "users",
        "users_v2",
      );
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("dispatches drop after the user confirms", async () => {
    dropCollectionMock.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <CollectionDdlDialog
        open
        mode="drop"
        connectionId="conn-mongo"
        database="app"
        collection="users"
        onClose={onClose}
      />,
    );

    await user.click(screen.getByTestId("collection-ddl-save"));

    await waitFor(() => {
      expect(dropCollectionMock).toHaveBeenCalledWith(
        "conn-mongo",
        "app",
        "users",
        true,
      );
    });
    expect(onClose).toHaveBeenCalled();
  });
});
