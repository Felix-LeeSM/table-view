import { describe, expect, it } from "vitest";
import { formatGridWaitDiagnostic } from "../../e2e/smoke/grid-wait-diagnostic";

describe("grid wait diagnostics", () => {
  it("surfaces backend alerts when grid never appears", () => {
    const message = formatGridWaitDiagnostic({
      visibleAlerts: ["Oracle SELECT failed: ORA-00942"],
      bodyText: "Launcher Connections E2E Oracle",
    });

    expect(message).toContain("visible_alerts");
    expect(message).toContain("Oracle SELECT failed: ORA-00942");
    expect(message).toContain("body=");
  });
});
