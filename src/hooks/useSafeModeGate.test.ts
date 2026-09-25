// D-4 — `useSafeModeGate` is pure store wiring around
// `decideSafeModeAction` (covered by `src/lib/safeMode.test.ts`). These
// tests assert that the hook reads from `useSafeModeStore` and
// `useConnectionStore` correctly; the decision matrix itself is not
// re-tested here to avoid duplicate coverage. date 2026-05-02.
//
// ADR 0022 Phase 1 — the destructive-only policy needs no UI-level
// read-only gate; the per-statement `useSafeModeGate.decide` covers the
// destructive dialog. date 2026-05-08.

import { useConnectionStore } from "@stores/connectionStore";
import { SAFE_MODE_STORAGE_KEY, useSafeModeStore } from "@stores/safeModeStore";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { StatementAnalysis } from "@/lib/sql/sqlSafety";
import type { ConnectionConfig } from "@/types/connection";
import { useSafeModeGate } from "./useSafeModeGate";

const DANGER: StatementAnalysis = {
  kind: "ddl-drop",
  severity: "danger",
  reasons: ["DROP TABLE"],
};

function makeConn(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: "c1",
    name: "test",
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "u",
    database: "db",
    groupId: null,
    color: null,
    hasPassword: false,
    paradigm: "rdb",
    environment: "production",
    ...overrides,
  };
}

describe("useSafeModeGate (store wiring)", () => {
  beforeEach(() => {
    localStorage.removeItem(SAFE_MODE_STORAGE_KEY);
    useSafeModeStore.setState({ mode: "strict" });
    useConnectionStore.setState({ connections: [] });
  });

  it("[AC-245-H2] reads `mode` from useSafeModeStore", () => {
    // mode=warn + production + danger → confirm (lib decision matrix).
    // Asserts hook propagates `mode` change into the pure call.
    useConnectionStore.setState({ connections: [makeConn()] });
    useSafeModeStore.setState({ mode: "warn" });
    const { result } = renderHook(() => useSafeModeGate("c1"));
    expect(result.current.decide(DANGER).action).toBe("confirm");
  });

  it("[AC-245-H2] reads `environment` from useConnectionStore via connectionId", () => {
    // staging + warn + danger → allow (non-production warn is unguarded
    // under the destructive-only policy). Strict on staging would
    // `confirm` (M.1 new flow); we use warn here so the result differs
    // from the production + warn case above (confirm) only by environment,
    // proving environment propagation independently of mode.
    useConnectionStore.setState({
      connections: [makeConn({ environment: "staging" })],
    });
    useSafeModeStore.setState({ mode: "warn" });
    const { result } = renderHook(() => useSafeModeGate("c1"));
    expect(result.current.decide(DANGER).action).toBe("allow");
  });

  it("[AC-245-H2] missing connection id uses null environment by default", () => {
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    const { result } = renderHook(() => useSafeModeGate("missing"));
    expect(result.current.decide(DANGER).action).toBe("allow");
  });

  // Reason: #1125 (2026-07-04) — a non-canonical stored tag ("Production",
  // "prod", "production ") must NOT masquerade as production. It is
  // canonicalized to null at the gate → env-unset → allow (#1114 policy);
  // the "Unknown" ConnectionItem badge is the surfaced signal.
  it("[#1125] non-canonical environment tag is not treated as production", () => {
    useConnectionStore.setState({
      connections: [makeConn({ environment: "Production" })],
    });
    useSafeModeStore.setState({ mode: "off" });
    const { result } = renderHook(() => useSafeModeGate("c1"));
    expect(result.current.decide(DANGER).action).toBe("allow");
  });

  it("[AC-436-H2] null connectionId still maps to null environment", () => {
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "warn" });
    const { result } = renderHook(() => useSafeModeGate(null));
    expect(result.current.decide(DANGER).action).toBe("allow");
  });
});
