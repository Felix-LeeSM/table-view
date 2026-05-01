import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SqlPreviewDialog from "@components/structure/SqlPreviewDialog";

// ---------------------------------------------------------------------------
// Sprint 109 — SqlPreviewDialog uses SqlSyntax for syntax-highlighted preview.
// AC-01: keyword token spans rendered with `text-syntax-keyword` class.
// AC-02: empty sql falls back to "-- No changes to preview" placeholder.
// AC-03: confirm/cancel callbacks fire from the footer buttons.
// AC-04: regression coverage on the existing preview-body container.
// ---------------------------------------------------------------------------

describe("SqlPreviewDialog (sprint-109 syntax highlight)", () => {
  it("AC-01: highlights SQL keywords with the text-syntax-keyword token", () => {
    render(
      <SqlPreviewDialog
        sql="CREATE TABLE foo (id INT);"
        loading={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // SqlSyntax tokenises the SQL into nested spans; the CREATE / TABLE
    // keywords must end up inside spans carrying the keyword token class.
    const dialog = screen.getByRole("dialog");
    const keywordSpans = dialog.querySelectorAll("span.text-syntax-keyword");
    expect(keywordSpans.length).toBeGreaterThan(0);

    const keywordTexts = Array.from(keywordSpans).map((el) => el.textContent);
    expect(keywordTexts).toContain("CREATE");
    expect(keywordTexts).toContain("TABLE");
  });

  it("AC-02: renders the placeholder when sql is empty and skips SqlSyntax", () => {
    render(
      <SqlPreviewDialog
        sql=""
        loading={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("-- No changes to preview")).toBeInTheDocument();
    // Empty sql means SqlSyntax must NOT render: no keyword spans should
    // appear in the dialog body.
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelectorAll("span.text-syntax-keyword").length).toBe(0);
  });

  it("AC-02: whitespace-only sql is treated as empty (placeholder shown)", () => {
    render(
      <SqlPreviewDialog
        sql={"   \n  "}
        loading={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("-- No changes to preview")).toBeInTheDocument();
  });

  it("AC-03: clicking Execute invokes onConfirm", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <SqlPreviewDialog
        sql="CREATE TABLE foo (id INT);"
        loading={false}
        error={null}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /execute/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("AC-03: clicking Cancel invokes onCancel", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <SqlPreviewDialog
        sql="CREATE TABLE foo (id INT);"
        loading={false}
        error={null}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // AC-187-03a — production environment renders the color stripe so the
  // structure-surface SQL preview reads at a glance matching the DataGrid /
  // EditableQueryResultGrid stripe Sprint 185 introduced. date 2026-05-01.
  it("[AC-187-03a] production environment renders color stripe", () => {
    render(
      <SqlPreviewDialog
        sql="DROP INDEX idx_users_email"
        loading={false}
        error={null}
        environment="production"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    const stripe = dialog.querySelector(
      '[data-environment-stripe="production"]',
    );
    expect(stripe).not.toBeNull();
    expect(stripe?.getAttribute("aria-hidden")).toBe("true");
  });
});
