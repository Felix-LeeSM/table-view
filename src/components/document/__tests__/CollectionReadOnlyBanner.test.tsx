import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CollectionReadOnlyBanner from "../CollectionReadOnlyBanner";
import { COLLECTION_READONLY_BANNER_TEXT } from "@lib/strings/document";

describe("CollectionReadOnlyBanner", () => {
  it("renders the default text from the shared constants module", () => {
    render(<CollectionReadOnlyBanner />);

    const banner = screen.getByRole("status");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(COLLECTION_READONLY_BANNER_TEXT);
    expect(banner).toHaveAttribute("aria-live", "polite");
  });

  it("renders a custom message when the message prop is supplied", () => {
    render(<CollectionReadOnlyBanner message="Custom limitation copy." />);

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Custom limitation copy.");
    // Default copy must NOT leak through when an override is provided.
    expect(banner).not.toHaveTextContent(COLLECTION_READONLY_BANNER_TEXT);
  });

  it("does not render a dismiss/close button (banner is non-dismissible)", () => {
    render(<CollectionReadOnlyBanner />);

    expect(screen.queryByRole("button", { name: /dismiss|close/i })).toBeNull();
    // Defensive: any button at all would be a regression for a status-only
    // surface, so guard against future additions.
    expect(screen.queryByRole("button")).toBeNull();
  });
});
