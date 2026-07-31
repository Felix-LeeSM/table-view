// Sprint 351 (2026-05-15) — CreateMongoIndexDialog full-option modal.
//
// 작성 이유: AC-351-04 의 5 option group (compound fields, unique/sparse,
// TTL with compound-aware gate, partialFilterExpression JSON validation,
// collation locale+strength) + Save 동작 (happy / driver-error inline
// alert) 을 검증한다. createMongoIndex 는 vi.mock 으로 캡처.
//
// #1791 (2026-08-01) — 필드 방향 / collation strength 가 native `<select>` 에서
// Radix `<Select>` 로 옮겨갔다. Radix 는 trigger 버튼(role="combobox") + portal
// listbox 라 `fireEvent.change` 가 닿지 않는다: trigger 클릭 → `role="option"`
// 클릭으로 고른다.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { CreateMongoIndexDialog } from "../CreateMongoIndexDialog";

/** Open a Radix `<Select>` by its trigger accessible name and click one of the
 *  portaled options. Replaces the `fireEvent.change` the native `<select>` took. */
async function pickOption(triggerName: string, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerName }));
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
}

const createMongoIndexMock = vi.fn();
beforeEach(() => {
  setupTauriMock({
    createMongoIndex: (...args: unknown[]) => createMongoIndexMock(...args),
  });
});

beforeEach(() => {
  createMongoIndexMock.mockReset();
});

const baseProps = {
  connectionId: "conn-mongo",
  database: "app",
  collection: "users",
  onClose: vi.fn(),
  onCreated: vi.fn(),
};

describe("CreateMongoIndexDialog", () => {
  it("renders the dialog with every option group", () => {
    render(
      <CreateMongoIndexDialog
        {...baseProps}
        open
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.getByTestId("mongo-create-index-dialog")).toBeInTheDocument();
    expect(
      screen.getByTestId("mongo-create-index-field-name-0"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("mongo-create-index-unique")).toBeInTheDocument();
    expect(screen.getByTestId("mongo-create-index-sparse")).toBeInTheDocument();
    expect(screen.getByTestId("mongo-create-index-ttl")).toBeInTheDocument();
    expect(
      screen.getByTestId("mongo-create-index-partial"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("mongo-create-index-collation-locale"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Collation strength" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Field 1 direction" }),
    ).toBeInTheDocument();
  });

  it("disables Save when every field row is blank", () => {
    render(
      <CreateMongoIndexDialog
        {...baseProps}
        open
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    const save = screen.getByTestId("mongo-create-index-save");
    expect(save).toBeDisabled();
  });

  it("enables Save once at least one field row has a name", async () => {
    render(
      <CreateMongoIndexDialog
        {...baseProps}
        open
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    const fieldInput = screen.getByTestId("mongo-create-index-field-name-0");
    fireEvent.change(fieldInput, { target: { value: "email" } });
    const save = screen.getByTestId("mongo-create-index-save");
    expect(save).not.toBeDisabled();
  });

  it("disables expireAfterSeconds and shows a hint when 2+ field rows are present (compound)", async () => {
    render(
      <CreateMongoIndexDialog
        {...baseProps}
        open
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    const addField = screen.getByTestId("mongo-create-index-add-field");
    await userEvent.click(addField);
    const ttl = screen.getByTestId("mongo-create-index-ttl");
    expect(ttl).toBeDisabled();
    const toggle = screen.getByTestId("mongo-create-index-ttl-toggle");
    expect(toggle).toBeDisabled();
    expect(
      screen.getByTestId("mongo-create-index-ttl-hint"),
    ).toBeInTheDocument();
  });

  it("disables Save and paints inline alert when partialFilterExpression JSON is invalid", async () => {
    render(
      <CreateMongoIndexDialog
        {...baseProps}
        open
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    const fieldInput = screen.getByTestId("mongo-create-index-field-name-0");
    fireEvent.change(fieldInput, { target: { value: "email" } });
    const partial = screen.getByTestId("mongo-create-index-partial");
    fireEvent.change(partial, { target: { value: "{ not json" } });
    const err = await screen.findByTestId("mongo-create-index-partial-error");
    expect(err).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("mongo-create-index-save")).toBeDisabled();
  });

  it("re-enables Save when partialFilterExpression is cleared back to empty", async () => {
    render(
      <CreateMongoIndexDialog
        {...baseProps}
        open
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    const fieldInput = screen.getByTestId("mongo-create-index-field-name-0");
    fireEvent.change(fieldInput, { target: { value: "email" } });
    const partial = screen.getByTestId("mongo-create-index-partial");
    fireEvent.change(partial, { target: { value: "garbage" } });
    expect(screen.getByTestId("mongo-create-index-save")).toBeDisabled();
    fireEvent.change(partial, { target: { value: "" } });
    expect(screen.getByTestId("mongo-create-index-save")).not.toBeDisabled();
  });

  it("invokes createMongoIndex with the assembled request on Save and closes on success", async () => {
    createMongoIndexMock.mockResolvedValueOnce({ name: "email_1" });
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(
      <CreateMongoIndexDialog
        {...baseProps}
        open
        onClose={onClose}
        onCreated={onCreated}
      />,
    );
    const fieldInput = screen.getByTestId("mongo-create-index-field-name-0");
    fireEvent.change(fieldInput, { target: { value: "email" } });
    const unique = screen.getByTestId("mongo-create-index-unique");
    await userEvent.click(unique);
    const save = screen.getByTestId("mongo-create-index-save");
    await userEvent.click(save);
    await waitFor(() => {
      expect(createMongoIndexMock).toHaveBeenCalledTimes(1);
    });
    const args = createMongoIndexMock.mock.calls[0];
    if (!args) throw new Error("createMongoIndex was not called");
    expect(args[0]).toBe("conn-mongo");
    expect(args[1]).toBe("app");
    expect(args[2]).toBe("users");
    expect(args[3].fields).toEqual([{ name: "email", direction: "asc" }]);
    expect(args[3].unique).toBe(true);
    expect(args[3].collation).toBeUndefined();
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onCreated).toHaveBeenCalledWith("email_1");
  });

  it("keeps the dialog open and paints role=alert on driver error", async () => {
    createMongoIndexMock.mockRejectedValueOnce(
      new Error("E11000 duplicate key"),
    );
    const onClose = vi.fn();
    render(
      <CreateMongoIndexDialog
        {...baseProps}
        open
        onClose={onClose}
        onCreated={vi.fn()}
      />,
    );
    const fieldInput = screen.getByTestId("mongo-create-index-field-name-0");
    fireEvent.change(fieldInput, { target: { value: "email" } });
    const save = screen.getByTestId("mongo-create-index-save");
    await userEvent.click(save);
    const errAlert = await screen.findByTestId("mongo-create-index-error");
    expect(errAlert).toHaveAttribute("role", "alert");
    expect(errAlert).toHaveTextContent(/duplicate key/i);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("mongo-create-index-dialog")).toBeInTheDocument();
    // Input preserved.
    expect(fieldInput).toHaveValue("email");
  });

  it("omits collation from the payload when locale is blank", async () => {
    createMongoIndexMock.mockResolvedValueOnce({ name: "n_1" });
    render(
      <CreateMongoIndexDialog
        {...baseProps}
        open
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("mongo-create-index-field-name-0"), {
      target: { value: "n" },
    });
    await userEvent.click(screen.getByTestId("mongo-create-index-save"));
    await waitFor(() => {
      expect(createMongoIndexMock).toHaveBeenCalledTimes(1);
    });
    const call = createMongoIndexMock.mock.calls[0];
    if (!call) throw new Error("createMongoIndex was not called");
    expect(call[3].collation).toBeUndefined();
  });

  it("includes collation when locale is filled in", async () => {
    createMongoIndexMock.mockResolvedValueOnce({ name: "n_1" });
    render(
      <CreateMongoIndexDialog
        {...baseProps}
        open
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("mongo-create-index-field-name-0"), {
      target: { value: "n" },
    });
    fireEvent.change(
      screen.getByTestId("mongo-create-index-collation-locale"),
      { target: { value: "en" } },
    );
    await pickOption("Collation strength", "strength 2");
    await userEvent.click(screen.getByTestId("mongo-create-index-save"));
    await waitFor(() => {
      expect(createMongoIndexMock).toHaveBeenCalledTimes(1);
    });
    const call = createMongoIndexMock.mock.calls[0];
    if (!call) throw new Error("createMongoIndex was not called");
    expect(call[3].collation).toEqual({ locale: "en", strength: 2 });
  });

  // #1791 — the direction control moved to Radix; the picked value still has to
  // land on the right field row of the request. RED if `onValueChange` is not
  // wired back into `updateField`.
  it("#1791 — the per-row direction Select forwards the picked direction", async () => {
    createMongoIndexMock.mockResolvedValueOnce({ name: "email_-1" });
    render(
      <CreateMongoIndexDialog
        {...baseProps}
        open
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("mongo-create-index-field-name-0"), {
      target: { value: "email" },
    });

    await pickOption("Field 1 direction", "desc");
    expect(
      screen.getByRole("combobox", { name: "Field 1 direction" }),
    ).toHaveTextContent("desc");

    await userEvent.click(screen.getByTestId("mongo-create-index-save"));
    await waitFor(() => {
      expect(createMongoIndexMock).toHaveBeenCalledTimes(1);
    });
    const call = createMongoIndexMock.mock.calls[0];
    if (!call) throw new Error("createMongoIndex was not called");
    expect(call[3].fields).toEqual([{ name: "email", direction: "desc" }]);
  });

  // #1791 — the sprint-112 rule the eslint guard encodes: this dialog must not
  // fall back to a native `<select>`. Fails RED the moment one is reintroduced.
  it("#1791 — renders no native <select> (sprint-112 normalize)", () => {
    render(
      <CreateMongoIndexDialog
        {...baseProps}
        open
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("mongo-create-index-dialog").querySelector("select"),
    ).toBeNull();
  });
});
