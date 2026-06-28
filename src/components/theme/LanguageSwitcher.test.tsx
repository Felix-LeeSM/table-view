import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import i18n from "@lib/i18n";

vi.mock("@lib/tauri/settings", () => ({
  persistSettingValue: vi.fn().mockResolvedValue(undefined),
}));
import { persistSettingValue } from "@lib/tauri/settings";
import LanguageSwitcher from "./LanguageSwitcher";

describe("LanguageSwitcher", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.clearAllMocks();
  });

  it("switches language and persists the choice", async () => {
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByLabelText("한국어"));

    await waitFor(() => expect(i18n.language).toBe("ko"));
    expect(persistSettingValue).toHaveBeenCalledWith("locale", "ko");
  });

  it("does not persist when re-selecting the current language", () => {
    render(<LanguageSwitcher />);
    // Re-clicking the active item is a no-op (handleChange early-returns on
    // same-locale, and ToggleGroup's deselect "" fails the guard too).
    fireEvent.click(screen.getByLabelText("English"));

    expect(persistSettingValue).not.toHaveBeenCalled();
    expect(i18n.language).toBe("en");
  });
});
