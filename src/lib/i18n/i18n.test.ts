import { describe, it, expect } from "vitest";
import i18n, {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  isSupportedLocale,
} from "./index";

describe("i18n foundation", () => {
  it("resolves en common keys", () => {
    expect(i18n.getFixedT("en", "common")("appearance")).toBe("Appearance");
    expect(i18n.getFixedT("en", "common")("mode.system")).toBe("System");
  });

  it("resolves ko common keys", () => {
    expect(i18n.getFixedT("ko", "common")("appearance")).toBe("외관");
    expect(i18n.getFixedT("ko", "common")("mode.system")).toBe("시스템");
  });

  it("interpolates the theme aria name", () => {
    expect(i18n.getFixedT("en", "common")("theme.aria", { name: "Nord" })).toBe(
      "Theme Nord",
    );
  });

  it("configures en as fallback language", () => {
    expect(i18n.options.fallbackLng).toContain("en");
  });

  it("guards supported locales", () => {
    expect(isSupportedLocale("ko")).toBe(true);
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("fr")).toBe(false);
    expect(isSupportedLocale(123)).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
  });

  it("keeps DEFAULT_LOCALE within the supported set", () => {
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE);
  });
});
