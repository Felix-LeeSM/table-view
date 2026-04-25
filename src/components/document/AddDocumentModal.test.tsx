import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AddDocumentModal, {
  type AddDocumentModalProps,
} from "./AddDocumentModal";

function renderModal(overrides: Partial<AddDocumentModalProps> = {}) {
  const props: AddDocumentModalProps = {
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<AddDocumentModal {...props} />) };
}

function setTextarea(value: string) {
  const textarea = screen.getByLabelText(
    "Document JSON",
  ) as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value } });
  return textarea;
}

describe("AddDocumentModal", () => {
  it("parses valid JSON and forwards the record to onSubmit", () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

    setTextarea('{"name":"Ada","age":36}');
    fireEvent.click(
      screen.getByRole("button", { name: "Submit add document" }),
    );

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ name: "Ada", age: 36 });
  });

  it("shows an error and does not submit when JSON is invalid", () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

    setTextarea("{ not valid json");
    fireEvent.click(
      screen.getByRole("button", { name: "Submit add document" }),
    );

    expect(onSubmit).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Invalid JSON/);
  });

  it("shows a required-document error when the textarea is empty", () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

    setTextarea("");
    fireEvent.click(
      screen.getByRole("button", { name: "Submit add document" }),
    );

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(
      /Document is required/,
    );
  });

  it("rejects a JSON array with a non-object error", () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

    setTextarea("[1,2,3]");
    fireEvent.click(
      screen.getByRole("button", { name: "Submit add document" }),
    );

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(
      /Document must be a JSON object/,
    );
  });

  it("invokes onCancel when the Cancel button is clicked", () => {
    const onCancel = vi.fn();
    renderModal({ onCancel });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("surfaces the parent-provided error prop via role=alert", () => {
    renderModal({ error: "duplicate key (E11000)" });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/duplicate key/);
  });

  it("submits via Cmd+Enter keyboard shortcut from the textarea", () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

    const textarea = setTextarea('{"name":"Grace"}');
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ name: "Grace" });
  });
});
