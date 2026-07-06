// Issue #1369 — characterization test for the shared query-log formatters
// extracted from QueryLog.tsx / GlobalQueryLogPanel.tsx (previously copy-pasted
// module-private functions with no direct coverage).

import { describe, it, expect, afterEach, vi } from "vitest";
import { truncateSql, formatRelativeTime } from "./queryLogFormat";

describe("truncateSql", () => {
  it("returns the string unchanged when at or under the limit", () => {
    expect(truncateSql("SELECT 1", 80)).toBe("SELECT 1");
    expect(truncateSql("abcde", 5)).toBe("abcde");
  });

  it("appends an ellipsis when over the limit", () => {
    expect(truncateSql("abcdef", 5)).toBe("abcde...");
  });
});

describe("formatRelativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function at(offsetMs: number): number {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    return now - offsetMs;
  }

  it("buckets sub-5s as 'just now'", () => {
    expect(formatRelativeTime(at(2_000))).toBe("just now");
  });

  it("buckets seconds, minutes, hours, days", () => {
    expect(formatRelativeTime(at(30_000))).toBe("30s ago");
    expect(formatRelativeTime(at(5 * 60_000))).toBe("5m ago");
    expect(formatRelativeTime(at(3 * 3_600_000))).toBe("3h ago");
    expect(formatRelativeTime(at(2 * 86_400_000))).toBe("2d ago");
  });
});
