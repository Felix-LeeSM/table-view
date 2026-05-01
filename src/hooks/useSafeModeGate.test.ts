// AC-188-02 — `useSafeModeGate` decision-matrix tests. Pin every cell of
// the table the contract enumerates: safe analysis (always allow), non-prod
// environment (always allow), production × strict (block), production ×
// warn (confirm), production × off (allow). Block reason text is checked
// verbatim because consumers paste it into queryState/error UIs and a drift
// would silently change user-visible copy. date 2026-05-01.
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSafeModeGate } from "./useSafeModeGate";
import { useSafeModeStore, SAFE_MODE_STORAGE_KEY } from "@stores/safeModeStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { StatementAnalysis } from "@/lib/sqlSafety";
import type { ConnectionConfig } from "@/types/connection";

const DANGER: StatementAnalysis = {
  kind: "ddl-drop",
  severity: "danger",
  reasons: ["DROP TABLE"],
};
const SAFE: StatementAnalysis = {
  kind: "select",
  severity: "safe",
  reasons: [],
};

function makeConn(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: "c1",
    name: "test",
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "u",
    database: "db",
    group_id: null,
    color: null,
    has_password: false,
    paradigm: "rdb",
    environment: "production",
    ...overrides,
  };
}

describe("useSafeModeGate", () => {
  beforeEach(() => {
    localStorage.removeItem(SAFE_MODE_STORAGE_KEY);
    useSafeModeStore.setState({ mode: "strict" });
    useConnectionStore.setState({ connections: [] });
  });

  it("[AC-188-02a] safe analysis → allow regardless of mode/env", () => {
    useConnectionStore.setState({ connections: [makeConn()] });
    useSafeModeStore.setState({ mode: "strict" });
    const { result } = renderHook(() => useSafeModeGate("c1"));
    expect(result.current.decide(SAFE)).toEqual({ action: "allow" });
  });

  it("[AC-188-02b] non-production environment → allow even with strict + danger", () => {
    useConnectionStore.setState({
      connections: [makeConn({ environment: "staging" })],
    });
    useSafeModeStore.setState({ mode: "strict" });
    const { result } = renderHook(() => useSafeModeGate("c1"));
    expect(result.current.decide(DANGER)).toEqual({ action: "allow" });
  });

  it("[AC-188-02c] production × strict + danger → block with canonical reason", () => {
    useConnectionStore.setState({ connections: [makeConn()] });
    useSafeModeStore.setState({ mode: "strict" });
    const { result } = renderHook(() => useSafeModeGate("c1"));
    const decision = result.current.decide(DANGER);
    expect(decision.action).toBe("block");
    if (decision.action === "block") {
      expect(decision.reason).toBe(
        "Safe Mode blocked: DROP TABLE (toggle Safe Mode off in toolbar to override)",
      );
    }
  });

  it("[AC-188-02d] production × warn + danger → confirm with reason verbatim", () => {
    useConnectionStore.setState({ connections: [makeConn()] });
    useSafeModeStore.setState({ mode: "warn" });
    const { result } = renderHook(() => useSafeModeGate("c1"));
    const decision = result.current.decide(DANGER);
    expect(decision.action).toBe("confirm");
    if (decision.action === "confirm") {
      expect(decision.reason).toBe("DROP TABLE");
    }
  });

  it("[AC-188-02e] production × off + danger → allow", () => {
    useConnectionStore.setState({ connections: [makeConn()] });
    useSafeModeStore.setState({ mode: "off" });
    const { result } = renderHook(() => useSafeModeGate("c1"));
    expect(result.current.decide(DANGER)).toEqual({ action: "allow" });
  });

  it("[AC-188-02f] missing connection (id not found) → treated as non-production / allow", () => {
    // Mongo aggregate path can fire before the connection store has hydrated
    // a particular id; default to safe (allow) rather than block.
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "strict" });
    const { result } = renderHook(() => useSafeModeGate("missing"));
    expect(result.current.decide(DANGER)).toEqual({ action: "allow" });
  });
});
