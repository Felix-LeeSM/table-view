import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges multiple class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles empty inputs", () => {
    expect(cn("", null, undefined, false, "active")).toBe("active");
  });

  it("preserves non-conflicting classes", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });
});
