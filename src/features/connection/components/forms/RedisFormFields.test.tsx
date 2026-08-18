import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionDraft } from "@/types/connection";
import RedisFormFields from "./RedisFormFields";

function makeDraft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "",
    name: "",
    dbType: "redis",
    host: "localhost",
    port: 6379,
    user: "",
    password: null,
    database: "0",
    groupId: null,
    color: null,
    paradigm: "kv",
    sslMode: "prefer",
    ...overrides,
  };
}

const inputClass = "input";
const labelClass = "label";

describe("RedisFormFields", () => {
  it("renders the database index defaulting to 0 with port 6379", () => {
    // #2436 — the dialog renders this component once per segment, and the TLS
    // toggle asserted below now belongs to `security`. Stacking both sections
    // reads the same DOM this test read before the split; the two render
    // disjoint controls, so ids and labels stay unique.
    const shared = {
      draft: makeDraft(),
      onChange: vi.fn(),
      passwordInput: "",
      setPasswordInput: vi.fn(),
      isEditing: false,
      hadPassword: false,
      clearPassword: false,
      setClearPassword: vi.fn(),
      inputClass,
      labelClass,
    };
    render(
      <>
        <RedisFormFields section="basic" {...shared} />
        <RedisFormFields section="security" {...shared} />
      </>,
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
        section="basic"
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

  // Issue #1063 — redis/valkey gain the skip-verify opt-in. Guard the
  // redis-specific wiring: the trust checkbox appears only with TLS on, and
  // toggling TLS off clears a stale trust choice.
  describe("skip-verify opt-in (#1063)", () => {
    function renderRedis(
      overrides: Partial<ConnectionDraft>,
      onChange = vi.fn(),
    ) {
      render(
        <RedisFormFields
          section="security"
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

    it("reveals the trust checkbox only once TLS is on", () => {
      renderRedis({ sslMode: "prefer" });
      expect(
        screen.queryByLabelText("Trust server certificate"),
      ).not.toBeInTheDocument();
      renderRedis({ sslMode: "verify-full" });
      expect(
        screen.getByLabelText("Trust server certificate"),
      ).toBeInTheDocument();
    });

    it("clears a stale skip-verify choice when TLS is turned off", () => {
      const onChange = renderRedis({ sslMode: "require" });
      act(() => {
        fireEvent.click(screen.getByLabelText("Enable TLS"));
      });
      expect(onChange).toHaveBeenCalledWith({
        sslMode: "prefer",
        caCertPath: null,
      });
    });
  });
});
