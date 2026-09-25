// DropMongoIndexDialog typing-confirm modal.
//
// Reason: AC-351-05 — the Confirm button stays disabled until the
// typing-confirm matches; on the happy path `dropMongoIndex` is called,
// onDropped/toast fire and the modal closes; on a driver error the modal
// stays open with an inline role=alert.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { DropMongoIndexDialog } from "../DropMongoIndexDialog";

const dropMongoIndexMock = vi.fn();
beforeEach(() => {
  setupTauriMock({
    dropMongoIndex: (...args: unknown[]) => dropMongoIndexMock(...args),
  });
});

beforeEach(() => {
  dropMongoIndexMock.mockReset();
});

const baseProps = {
  connectionId: "conn-mongo",
  database: "app",
  collection: "users",
  indexName: "email_1",
};

describe("DropMongoIndexDialog", () => {
  it("renders the dialog with the typing-confirm input", () => {
    render(
      <DropMongoIndexDialog
        {...baseProps}
        open
        onClose={vi.fn()}
        onDropped={vi.fn()}
      />,
    );
    expect(screen.getByTestId("mongo-drop-index-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("mongo-drop-index-typing")).toBeInTheDocument();
  });

  it("disables Confirm until the user types the exact index name", async () => {
    render(
      <DropMongoIndexDialog
        {...baseProps}
        open
        onClose={vi.fn()}
        onDropped={vi.fn()}
      />,
    );
    const confirm = screen.getByTestId("mongo-drop-index-confirm");
    expect(confirm).toBeDisabled();
    const typing = screen.getByTestId("mongo-drop-index-typing");
    fireEvent.change(typing, { target: { value: "email" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(typing, { target: { value: "email_1" } });
    expect(confirm).not.toBeDisabled();
  });

  it("invokes dropMongoIndex on Confirm and closes + onDropped on success", async () => {
    dropMongoIndexMock.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const onDropped = vi.fn();
    render(
      <DropMongoIndexDialog
        {...baseProps}
        open
        onClose={onClose}
        onDropped={onDropped}
      />,
    );
    fireEvent.change(screen.getByTestId("mongo-drop-index-typing"), {
      target: { value: "email_1" },
    });
    await userEvent.click(screen.getByTestId("mongo-drop-index-confirm"));
    await waitFor(() => {
      expect(dropMongoIndexMock).toHaveBeenCalledWith(
        "conn-mongo",
        "app",
        "users",
        "email_1",
        true,
      );
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onDropped).toHaveBeenCalledWith("email_1");
  });

  it("paints role=alert with the driver error and keeps the dialog open on failure", async () => {
    dropMongoIndexMock.mockRejectedValueOnce(new Error("IndexNotFound"));
    const onClose = vi.fn();
    render(
      <DropMongoIndexDialog
        {...baseProps}
        open
        onClose={onClose}
        onDropped={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("mongo-drop-index-typing"), {
      target: { value: "email_1" },
    });
    await userEvent.click(screen.getByTestId("mongo-drop-index-confirm"));
    const alert = await screen.findByTestId("mongo-drop-index-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(/IndexNotFound/);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("mongo-drop-index-dialog")).toBeInTheDocument();
  });
});
