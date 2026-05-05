/**
 * Sprint 204 — `makeLogger` DEV / prod gate behaviour.
 *
 * The contract is asymmetric: in DEV (`isDev=true`) the helpers forward
 * the spread args to the matching `console.*` channel verbatim; in prod
 * (`isDev=false`) every helper is a no-op. We exercise both modes for
 * each level (`warn` / `error` / `info`) so a future regression that
 * accidentally swaps the gate condition surfaces immediately.
 *
 * Why test `makeLogger` and not the bound `logger` export? `logger` is
 * fixed at module-init from `import.meta.env.DEV`, which Vite inlines at
 * build time and Vitest cannot toggle per-test. `makeLogger(true|false)`
 * is the seam — the same builder produces the production binding too,
 * so covering both modes covers the behaviour of `logger` as well.
 *
 * Written 2026-05-05 (Sprint 204 — logger 중앙화 + DEV-only gate).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeLogger } from "./logger";

describe("makeLogger", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Each test starts with fresh spies so call counts are scoped to the
    // single behaviour under test.
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  describe("DEV mode (isDev=true)", () => {
    it("warn forwards args to console.warn", () => {
      const log = makeLogger(true);
      log.warn("[label]", "boom", { detail: 1 });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith("[label]", "boom", { detail: 1 });
    });

    it("error forwards args to console.error", () => {
      const log = makeLogger(true);
      const err = new Error("oops");
      log.error("[ctx]", err);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith("[ctx]", err);
    });

    it("info forwards args to console.info", () => {
      const log = makeLogger(true);
      log.info("[boot]", "phase=ready");
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledWith("[boot]", "phase=ready");
    });
  });

  describe("prod mode (isDev=false)", () => {
    it("warn is a no-op", () => {
      const log = makeLogger(false);
      log.warn("[label]", "boom");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("error is a no-op", () => {
      const log = makeLogger(false);
      log.error("[ctx]", new Error("oops"));
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("info is a no-op", () => {
      const log = makeLogger(false);
      log.info("[boot]", "phase=ready");
      expect(infoSpy).not.toHaveBeenCalled();
    });

    it("does not forward to other channels by mistake", () => {
      const log = makeLogger(false);
      log.warn("warn-arg");
      log.error("error-arg");
      log.info("info-arg");
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
    });
  });
});
