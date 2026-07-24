import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import MongoFormFields from "./MongoFormFields";
import type { ConnectionDraft } from "@/types/connection";

function makeDraft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "",
    name: "",
    dbType: "mongodb",
    host: "localhost",
    port: 27017,
    user: "",
    password: null,
    database: "",
    groupId: null,
    color: null,
    paradigm: "document",
    authSource: null,
    replicaSet: null,
    sslMode: "prefer",
    ...overrides,
  };
}

const inputClass = "input";
const labelClass = "label";

describe("MongoFormFields", () => {
  it("renders Mongo-specific fields (authSource / replicaSet / tls) + optional user/password labels", () => {
    render(
      <MongoFormFields
        draft={makeDraft()}
        onChange={vi.fn()}
        passwordInput=""
        setPasswordInput={vi.fn()}
        isEditing={false}
        hadPassword={false}
        clearPassword={false}
        setClearPassword={vi.fn()}
        inputClass={inputClass}
        labelClass={labelClass}
      />,
    );
    expect(screen.getByLabelText("User (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Password (optional)")).toBeInTheDocument();
    // Sprint 381 (2026-05-17) — Mongo db-contract α: database 의 required
    // 가 풀린다. label = "Database (optional)" 로 affordance 명시.
    expect(screen.getByLabelText("Database (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Auth Source")).toBeInTheDocument();
    expect(screen.getByLabelText("Replica Set")).toBeInTheDocument();
    expect(screen.getByLabelText("Enable TLS")).toBeInTheDocument();
    expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
      "27017",
    );
  });

  it("propagates authSource / replicaSet / tlsEnabled through onChange", () => {
    const onChange = vi.fn();
    render(
      <MongoFormFields
        draft={makeDraft()}
        onChange={onChange}
        passwordInput=""
        setPasswordInput={vi.fn()}
        isEditing={false}
        hadPassword={false}
        clearPassword={false}
        setClearPassword={vi.fn()}
        inputClass={inputClass}
        labelClass={labelClass}
      />,
    );
    act(() => {
      fireEvent.change(
        screen.getByLabelText("Auth Source") as HTMLInputElement,
        { target: { value: "admin" } },
      );
    });
    expect(onChange).toHaveBeenCalledWith({ authSource: "admin" });

    act(() => {
      fireEvent.click(screen.getByLabelText("Enable TLS"));
    });
    // #1649 — enabling TLS on an on/off engine selects the secure verify-full.
    expect(onChange).toHaveBeenCalledWith({ sslMode: "verify-full" });
  });

  // Issue #1063/#1649 — the skip-verify opt-in (`trust server certificate`)
  // only appears once TLS is on, warns while active, and never lingers when TLS
  // is switched back off. #1649 folds the choice into `sslMode`.
  describe("skip-verify opt-in (#1649)", () => {
    function renderMongo(
      overrides: Partial<ConnectionDraft>,
      onChange = vi.fn(),
    ) {
      render(
        <MongoFormFields
          draft={makeDraft(overrides)}
          onChange={onChange}
          passwordInput=""
          setPasswordInput={vi.fn()}
          isEditing={false}
          hadPassword={false}
          clearPassword={false}
          setClearPassword={vi.fn()}
          inputClass={inputClass}
          labelClass={labelClass}
        />,
      );
      return onChange;
    }

    it("hides the trust checkbox while TLS is off", () => {
      renderMongo({ sslMode: "prefer" });
      expect(
        screen.queryByLabelText("Trust server certificate"),
      ).not.toBeInTheDocument();
    });

    it("reveals the trust checkbox once TLS is on and opts into skip-verify on click", () => {
      const onChange = renderMongo({ sslMode: "verify-full" });
      act(() => {
        fireEvent.click(screen.getByLabelText("Trust server certificate"));
      });
      // #1649 — skip-verify is the `require` posture.
      expect(onChange).toHaveBeenCalledWith({ sslMode: "require" });
    });

    it("warns while the skip-verify (require) posture is active", () => {
      renderMongo({ sslMode: "require" });
      expect(
        screen.getByText(/Certificate verification is skipped/),
      ).toBeInTheDocument();
    });

    it("returns to the driver default when TLS is turned off", () => {
      const onChange = renderMongo({ sslMode: "require" });
      act(() => {
        fireEvent.click(screen.getByLabelText("Enable TLS"));
      });
      expect(onChange).toHaveBeenCalledWith({ sslMode: "prefer" });
    });
  });
});
