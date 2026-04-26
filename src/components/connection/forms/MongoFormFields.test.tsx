import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import MongoFormFields from "./MongoFormFields";
import type { ConnectionDraft } from "@/types/connection";

function makeDraft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "",
    name: "",
    db_type: "mongodb",
    host: "localhost",
    port: 27017,
    user: "",
    password: null,
    database: "",
    group_id: null,
    color: null,
    paradigm: "document",
    auth_source: null,
    replica_set: null,
    tls_enabled: false,
    ...overrides,
  };
}

const inputClass = "input";
const labelClass = "label";

describe("MongoFormFields", () => {
  it("renders Mongo-specific fields (auth_source / replica_set / tls) + optional user/password labels", () => {
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
    expect(screen.getByLabelText("Database (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Auth Source")).toBeInTheDocument();
    expect(screen.getByLabelText("Replica Set")).toBeInTheDocument();
    expect(screen.getByLabelText("Enable TLS")).toBeInTheDocument();
    expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
      "27017",
    );
  });

  it("propagates auth_source / replica_set / tls_enabled through onChange", () => {
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
    expect(onChange).toHaveBeenCalledWith({ auth_source: "admin" });

    act(() => {
      fireEvent.click(screen.getByLabelText("Enable TLS"));
    });
    expect(onChange).toHaveBeenCalledWith({ tls_enabled: true });
  });
});
