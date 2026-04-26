import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import RedisFormFields from "./RedisFormFields";
import type { ConnectionDraft } from "@/types/connection";

function makeDraft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "",
    name: "",
    db_type: "redis",
    host: "localhost",
    port: 6379,
    user: "",
    password: null,
    database: "0",
    group_id: null,
    color: null,
    paradigm: "kv",
    tls_enabled: false,
    ...overrides,
  };
}

const inputClass = "input";
const labelClass = "label";

describe("RedisFormFields", () => {
  it("renders the database index defaulting to 0 with port 6379", () => {
    render(
      <RedisFormFields
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
    const dbIndex = screen.getByLabelText(
      "Redis database index (0-15)",
    ) as HTMLInputElement;
    expect(dbIndex.value).toBe("0");
    expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
      "6379",
    );
    expect(screen.getByLabelText("Username (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Password (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Enable TLS")).toBeInTheDocument();
  });

  it("clamps Redis database index to the [0, 15] range", () => {
    const onChange = vi.fn();
    render(
      <RedisFormFields
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
    const dbIndex = screen.getByLabelText(
      "Redis database index (0-15)",
    ) as HTMLInputElement;

    act(() => {
      fireEvent.change(dbIndex, { target: { value: "16" } });
    });
    expect(onChange).toHaveBeenCalledWith({ database: "15" });

    act(() => {
      fireEvent.change(dbIndex, { target: { value: "-2" } });
    });
    expect(onChange).toHaveBeenCalledWith({ database: "0" });

    act(() => {
      fireEvent.change(dbIndex, { target: { value: "5" } });
    });
    expect(onChange).toHaveBeenCalledWith({ database: "5" });
  });
});
