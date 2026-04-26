import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import MysqlFormFields from "./MysqlFormFields";
import type { ConnectionDraft } from "@/types/connection";

function makeDraft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "",
    name: "",
    db_type: "mysql",
    host: "localhost",
    port: 3306,
    user: "root",
    password: null,
    database: "",
    group_id: null,
    color: null,
    paradigm: "rdb",
    ...overrides,
  };
}

const inputClass = "input";
const labelClass = "label";

describe("MysqlFormFields", () => {
  it("renders MySQL defaults — user=root (NOT postgres), port=3306", () => {
    render(
      <MysqlFormFields
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
    const port = screen.getByLabelText("Port") as HTMLInputElement;
    const user = screen.getByLabelText("User") as HTMLInputElement;
    expect(port.value).toBe("3306");
    expect(user.value).toBe("root");
    expect(user.value).not.toBe("postgres");
  });

  it("propagates database changes through onChange", () => {
    const onChange = vi.fn();
    render(
      <MysqlFormFields
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
      fireEvent.change(screen.getByLabelText("Database") as HTMLInputElement, {
        target: { value: "myapp" },
      });
    });
    expect(onChange).toHaveBeenCalledWith({ database: "myapp" });
  });
});
