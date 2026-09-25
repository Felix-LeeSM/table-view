// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the one `${string}` is inside a test name and spells a TypeScript template-literal type, not an interpolation.

// Written 2026-05-16
//
// Reason: locks the round-trip contract of the `parseWorkspaceLabel(label)`
// helper for the migration to per-connection window labels
// (`workspace-{connection_id}`). Callers such as
// `useCurrentWindowConnectionId` and the workspace store's cross-window IPC
// bridge attach depend on it to derive connection_id safely from a label
// string.
//
// AC-361-04 round-trip:
//   - `parseWorkspaceLabel("workspace-abc-123")` → `"abc-123"`
//   - `parseWorkspaceLabel("launcher")` → `null`
//
// This file also type-checks AC-361-05 KnownWindowLabel exhaustiveness.
import { describe, expect, it } from "vitest";
import {
  formatWorkspaceLabel,
  type KnownWindowLabel,
  parseWorkspaceLabel,
} from "./window-label";

describe("parseWorkspaceLabel — AC-361-04 round-trip", () => {
  it("returns the connection_id for a `workspace-<id>` label", () => {
    expect(parseWorkspaceLabel("workspace-abc-123")).toBe("abc-123");
  });

  it("returns null for the launcher label", () => {
    expect(parseWorkspaceLabel("launcher")).toBeNull();
  });

  it("returns null for an unknown label string", () => {
    expect(parseWorkspaceLabel("totally-bogus")).toBeNull();
  });

  it("returns null for the legacy single 'workspace' label", () => {
    // Reason: the legacy single-workspace label is deprecated since the
    // move to per-connection labels. The match requires the full
    // `workspace-` prefix, separator included, rather than a bare prefix
    // check, so an empty conn_id (=`workspace`) cannot collide with a real
    // conn_id.
    expect(parseWorkspaceLabel("workspace")).toBeNull();
  });

  it("returns null for an empty connection_id (`workspace-`)", () => {
    expect(parseWorkspaceLabel("workspace-")).toBeNull();
  });

  it("preserves the full id when the conn_id contains additional dashes (UUID-like)", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(parseWorkspaceLabel(`workspace-${uuid}`)).toBe(uuid);
  });

  it("round-trips formatWorkspaceLabel → parseWorkspaceLabel", () => {
    const id = "conn-1";
    const label = formatWorkspaceLabel(id);
    expect(label).toBe("workspace-conn-1");
    expect(parseWorkspaceLabel(label)).toBe(id);
  });
});

describe("KnownWindowLabel — AC-361-05 type exhaustiveness", () => {
  it("narrows to launcher | workspace-${string} in a switch", () => {
    // Reason: union exhaustiveness is a type-check-time guarantee. The
    // `never` branch must be caught at compile time (the default arm is
    // unreachable). This test locks the working type narrowing with a
    // runtime assertion.
    function classify(label: KnownWindowLabel): "launcher" | "workspace" {
      switch (label) {
        case "launcher":
          return "launcher";
        default: {
          // narrowed to `workspace-${string}`; extract the conn id here.
          const id = parseWorkspaceLabel(label);
          if (id === null) {
            // unreachable — the type system must narrow everything except
            // launcher to `workspace-${string}`.
            throw new Error("exhaustiveness check broken");
          }
          return "workspace";
        }
      }
    }

    expect(classify("launcher")).toBe("launcher");
    expect(classify("workspace-conn-1")).toBe("workspace");
  });
});
