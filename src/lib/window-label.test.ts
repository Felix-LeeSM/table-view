// 작성 2026-05-16 (Phase 3 sprint-361)
//
// 사유: sprint-361 의 per-conn 윈도우 라벨 (`workspace-{connection_id}`)
// 마이그를 위한 `parseWorkspaceLabel(label)` 헬퍼의 round-trip 계약 잠금.
// 본 helper 는 sprint-365 (cross-window event routing) 및 sprint-366
// (`useCurrentWindowConnectionId`) 의 의존성으로, label string 에서
// connection_id 를 안전하게 derive 하는 책임을 가진다.
//
// AC-361-04 라운드트립:
//   - `parseWorkspaceLabel("workspace-abc-123")` → `"abc-123"`
//   - `parseWorkspaceLabel("launcher")` → `null`
//
// AC-361-05 KnownWindowLabel exhaustiveness 도 본 파일에서 type-check 한다.
import { describe, it, expect } from "vitest";
import {
  parseWorkspaceLabel,
  formatWorkspaceLabel,
  type KnownWindowLabel,
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
    // 사유: legacy single-workspace label 은 sprint-361 이후 deprecated.
    // 패턴 매치에 prefix 만 검사하지 않고 `workspace-` 접두 (separator 포함)
    // 를 요구해 빈 conn_id (=`workspace`) 와 정상 conn_id 가 충돌하지 않게.
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
    // 사유: union exhaustiveness 는 type-check 시점의 보증.
    // `never` branch 가 컴파일 시 잡혀야 (default arm 도달 불가) 한다.
    // 본 테스트는 type narrow 가 동작함을 runtime assertion 으로 잠근다.
    function classify(label: KnownWindowLabel): "launcher" | "workspace" {
      switch (label) {
        case "launcher":
          return "launcher";
        default: {
          // narrowed to `workspace-${string}` 여기서 conn id 추출.
          const id = parseWorkspaceLabel(label);
          if (id === null) {
            // unreachable — type system 이 launcher 만 빼고 모두
            // `workspace-${string}` 로 좁혀줘야 함.
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
