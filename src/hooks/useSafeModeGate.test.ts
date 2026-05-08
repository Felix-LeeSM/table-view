// Sprint 189 (D-4) — `useSafeModeGate` is now pure store wiring around
// `decideSafeModeAction` (covered by `src/lib/safeMode.test.ts`). These
// tests assert that the hook reads from `useSafeModeStore` and
// `useConnectionStore` correctly; the decision matrix itself is not
// re-tested here to avoid duplicate coverage.
//
// Sprint 188 baseline (AC-188-02) lived here as a 6-case matrix — the
// canonical-block-reason verbatim assertion was migrated to the lib test
// (AC-189-06a-3). date 2026-05-02.
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSafeModeGate, useSafeModeReadOnly } from "./useSafeModeGate";
import { useSafeModeStore, SAFE_MODE_STORAGE_KEY } from "@stores/safeModeStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { StatementAnalysis } from "@/lib/sql/sqlSafety";
import type { ConnectionConfig } from "@/types/connection";

const DANGER: StatementAnalysis = {
  kind: "ddl-drop",
  severity: "danger",
  reasons: ["DROP TABLE"],
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

describe("useSafeModeGate (store wiring)", () => {
  beforeEach(() => {
    localStorage.removeItem(SAFE_MODE_STORAGE_KEY);
    useSafeModeStore.setState({ mode: "strict" });
    useConnectionStore.setState({ connections: [] });
  });

  it("reads `mode` from useSafeModeStore", () => {
    // Sprint 190 — flip wiring assertion to use the warn → confirm path
    // because the previous "off + production → allow" branch became
    // "off + production → block" under prod-auto. Confirm is the only
    // remaining decision that requires `mode` to flow through (strict /
    // off both block on production-danger, so they don't disambiguate
    // mode propagation by themselves). date 2026-05-02.
    useConnectionStore.setState({ connections: [makeConn()] });
    useSafeModeStore.setState({ mode: "warn" });
    const { result } = renderHook(() => useSafeModeGate("c1"));
    // mode=warn + production + danger → confirm (lib decision matrix).
    // Asserts hook propagates `mode` change into the pure call.
    expect(result.current.decide(DANGER).action).toBe("confirm");
  });

  it("reads `environment` from useConnectionStore via connectionId", () => {
    useConnectionStore.setState({
      connections: [makeConn({ environment: "staging" })],
    });
    useSafeModeStore.setState({ mode: "strict" });
    const { result } = renderHook(() => useSafeModeGate("c1"));
    // staging + strict + danger → allow (non-prod path in lib matrix).
    // Asserts hook propagates `environment` lookup into the pure call.
    expect(result.current.decide(DANGER).action).toBe("allow");
  });

  it("missing connection (id not found) → null environment / allow", () => {
    // Mongo aggregate path can fire before the connection store has hydrated
    // a particular id; the hook normalises missing → null and the lib
    // matrix maps null → non-production → allow.
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "strict" });
    const { result } = renderHook(() => useSafeModeGate("missing"));
    expect(result.current.decide(DANGER).action).toBe("allow");
  });
});

// Sprint 243 — Strict-mode read-only gate. Coarser than the per-statement
// dangerous-DML gate above: returns true whenever the connection is
// production AND mode is `strict` or `off` (prod-auto upgrade). Drives
// the DataGrid's cell-edit + toolbar disable. Date 2026-05-08.
describe("useSafeModeReadOnly (DataGrid cell-edit gate)", () => {
  beforeEach(() => {
    localStorage.removeItem(SAFE_MODE_STORAGE_KEY);
    useConnectionStore.setState({ connections: [] });
  });

  it("production + strict → readOnly true", () => {
    useConnectionStore.setState({ connections: [makeConn()] });
    useSafeModeStore.setState({ mode: "strict" });
    const { result } = renderHook(() => useSafeModeReadOnly("c1"));
    expect(result.current).toBe(true);
  });

  it("production + off (prod-auto) → readOnly true", () => {
    useConnectionStore.setState({ connections: [makeConn()] });
    useSafeModeStore.setState({ mode: "off" });
    const { result } = renderHook(() => useSafeModeReadOnly("c1"));
    expect(result.current).toBe(true);
  });

  it("production + warn → readOnly false (warn-tier confirm path stays editable)", () => {
    useConnectionStore.setState({ connections: [makeConn()] });
    useSafeModeStore.setState({ mode: "warn" });
    const { result } = renderHook(() => useSafeModeReadOnly("c1"));
    expect(result.current).toBe(false);
  });

  it("staging + strict → readOnly false (non-production override)", () => {
    useConnectionStore.setState({
      connections: [makeConn({ environment: "staging" })],
    });
    useSafeModeStore.setState({ mode: "strict" });
    const { result } = renderHook(() => useSafeModeReadOnly("c1"));
    expect(result.current).toBe(false);
  });

  it("missing connection → readOnly false (null environment / non-prod path)", () => {
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "strict" });
    const { result } = renderHook(() => useSafeModeReadOnly("missing"));
    expect(result.current).toBe(false);
  });
});
