// DbLifecycleDialog 4-case matrix: RDB create / RDB drop / Mongo lazy create
// info / Mongo drop.
// Reason: the dialog dispatches real IPC instead of a placeholder. Guards the
// dispatch arguments + close for each of the 4 paradigm × mode cases, plus
// the informational copy for Mongo create (2026-05-15).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
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
        dbType="postgresql"
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
        dbType="postgresql"
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
        dbType="postgresql"
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
        dbType="mongodb"
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
        dbType="mongodb"
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

  // #1141 — the destructive DROP path shares role="alertdialog" + Cancel
  // focus with the other destructive confirms; CREATE stays a plain dialog.
  it("[#1141] drop mode uses role=alertdialog and focuses Cancel", () => {
    render(
      <DbLifecycleDialog
        open
        mode="drop"
        connectionId="conn-pg"
        database="analytics"
        dbType="postgresql"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /close database lifecycle dialog/i }),
    ).toHaveFocus();
  });

  it("[#1141] create mode stays a plain dialog (non-destructive)", () => {
    render(
      <DbLifecycleDialog
        open
        mode="create"
        connectionId="conn-pg"
        dbType="postgresql"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
