import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import OracleFormFields from "./OracleFormFields";
import type { ConnectionDraft } from "@/types/connection";

function makeDraft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "",
    name: "",
    dbType: "oracle",
    host: "localhost",
    port: 1521,
    user: "system",
    password: null,
    database: "FREEPDB1",
    groupId: null,
    color: null,
    paradigm: "rdb",
    ...overrides,
  };
}

const inputClass = "input";
const labelClass = "label";

describe("OracleFormFields", () => {
  it("renders service-name connection fields", () => {
    render(
      <OracleFormFields
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

    expect(screen.getByLabelText("Host")).toHaveValue("localhost");
    expect(screen.getByLabelText("Port")).toHaveValue(1521);
    expect(screen.getByLabelText("User")).toHaveValue("system");
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Service name")).toHaveValue("FREEPDB1");
    expect(screen.queryByLabelText("Database")).not.toBeInTheDocument();
  });

  it("stores the Oracle service name in the existing database field", () => {
    const onChange = vi.fn();
    render(
      <OracleFormFields
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
      fireEvent.change(screen.getByLabelText("Service name"), {
        target: { value: "XEPDB1" },
      });
    });

    expect(onChange).toHaveBeenCalledWith({ database: "XEPDB1" });
  });
});
