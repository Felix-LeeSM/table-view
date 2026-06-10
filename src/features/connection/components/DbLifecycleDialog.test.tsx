// Sprint 335 (2026-05-15) — Slice M live wire. DbLifecycleDialog 4-case
// 매트릭스: RDB create / RDB drop / Mongo lazy create info / Mongo drop.
// 작성 이유: 본 sprint 가 Sprint 327 placeholder 를 실제 IPC dispatch 로
// 교체한다. paradigm × mode 4 case 각각 dispatch 인자 + close + Mongo
// create 의 informational copy 가드.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DbLifecycleDialog } from "./DbLifecycleDialog";

const createRdbDatabaseMock = vi.fn();
const dropRdbDatabaseMock = vi.fn();
const dropMongoDatabaseMock = vi.fn();

vi.mock("@/lib/tauri/ddl", () => ({
  createRdbDatabase: (...args: unknown[]) => createRdbDatabaseMock(...args),
  dropRdbDatabase: (...args: unknown[]) => dropRdbDatabaseMock(...args),
}));
beforeEach(() => {
  setupTauriMock({
    dropMongoDatabase: (...args: unknown[]) => dropMongoDatabaseMock(...args),
  });
});

describe("DbLifecycleDialog (Sprint 335 — Slice M live wire)", () => {
  beforeEach(() => {
    createRdbDatabaseMock.mockReset();
    dropRdbDatabaseMock.mockReset();
    dropMongoDatabaseMock.mockReset();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <DbLifecycleDialog
        open={false}
        mode="create"
        connectionId="conn-pg"
        paradigm="table"
        onClose={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("dispatches CREATE DATABASE for the RDB paradigm", async () => {
    createRdbDatabaseMock.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <DbLifecycleDialog
        open
        mode="create"
        connectionId="conn-pg"
        paradigm="table"
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByTestId("db-lifecycle-name"), {
      target: { value: "analytics" },
    });
    await user.click(screen.getByTestId("db-lifecycle-save"));

    await waitFor(() => {
      expect(createRdbDatabaseMock).toHaveBeenCalledWith(
        "conn-pg",
        "analytics",
      );
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("dispatches DROP DATABASE for the RDB paradigm after confirmation", async () => {
    dropRdbDatabaseMock.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <DbLifecycleDialog
        open
        mode="drop"
        connectionId="conn-pg"
        database="analytics"
        paradigm="table"
        onClose={onClose}
      />,
    );

    await user.click(screen.getByTestId("db-lifecycle-save"));

    await waitFor(() => {
      expect(dropRdbDatabaseMock).toHaveBeenCalledWith("conn-pg", "analytics");
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders the lazy-create info for the Mongo paradigm and skips IPC", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <DbLifecycleDialog
        open
        mode="create"
        connectionId="conn-mongo"
        paradigm="document"
        onClose={onClose}
      />,
    );

    expect(screen.getByTestId("db-lifecycle-mongo-lazy")).toHaveTextContent(
      /on first write/i,
    );

    await user.click(screen.getByTestId("db-lifecycle-save"));

    expect(createRdbDatabaseMock).not.toHaveBeenCalled();
    expect(dropMongoDatabaseMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("dispatches dropMongoDatabase for the Mongo paradigm", async () => {
    dropMongoDatabaseMock.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <DbLifecycleDialog
        open
        mode="drop"
        connectionId="conn-mongo"
        database="staging"
        paradigm="document"
        onClose={onClose}
      />,
    );

    await user.click(screen.getByTestId("db-lifecycle-save"));

    await waitFor(() => {
      expect(dropMongoDatabaseMock).toHaveBeenCalledWith(
        "conn-mongo",
        "staging",
        true,
      );
    });
    expect(onClose).toHaveBeenCalled();
  });
});
