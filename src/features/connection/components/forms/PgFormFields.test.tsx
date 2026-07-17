import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PgFormFields from "./PgFormFields";
import type { ConnectionDraft } from "@/types/connection";

function makeDraft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "",
    name: "",
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: null,
    database: "postgres",
    groupId: null,
    color: null,
    paradigm: "rdb",
    ...overrides,
  };
}

const inputClass = "input";
const labelClass = "label";

describe("PgFormFields", () => {
  it("renders host, port, user, password, and database fields with PG defaults", () => {
    const onChange = vi.fn();
    const setPasswordInput = vi.fn();
    const setClearPassword = vi.fn();
    render(
      <PgFormFields
        draft={makeDraft()}
        onChange={onChange}
        passwordInput=""
        setPasswordInput={setPasswordInput}
        isEditing={false}
        hadPassword={false}
        clearPassword={false}
        setClearPassword={setClearPassword}
        inputClass={inputClass}
        labelClass={labelClass}
      />,
    );

    const host = screen.getByLabelText("Host") as HTMLInputElement;
    const port = screen.getByLabelText("Port") as HTMLInputElement;
    const user = screen.getByLabelText("User") as HTMLInputElement;
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    const database = screen.getByLabelText("Database") as HTMLInputElement;

    expect(host.value).toBe("localhost");
    expect(port.value).toBe("5432");
    expect(user.value).toBe("postgres");
    expect(password).toBeInTheDocument();
    expect(database.value).toBe("postgres");
    // PG default user is "postgres" — explicit anti-regression.
    expect(user.value).toBe("postgres");
  });

  it("propagates host changes through onChange", () => {
    const onChange = vi.fn();
    render(
      <PgFormFields
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
      fireEvent.change(screen.getByLabelText("Host") as HTMLInputElement, {
        target: { value: "db.example.com" },
      });
    });
    expect(onChange).toHaveBeenCalledWith({ host: "db.example.com" });
  });

  // #1063 — PG's TLS control is the sslmode dropdown (disable/prefer/require/
  // verify-full), a pure view over the stored (tlsEnabled, trust) pair. It
  // routes through the same `resolve_tls_decision` boundary as MSSQL, so every
  // selectable option maps to a valid combo — the invalid `trust=None` while
  // TLS is on can never be authored.
  describe("sslmode dropdown (#1063)", () => {
    function renderPg(draft: Partial<ConnectionDraft>, onChange = vi.fn()) {
      render(
        <PgFormFields
          draft={makeDraft(draft)}
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

    it("defaults an unset draft to Prefer (localhost dev keeps the driver default)", () => {
      renderPg({});
      expect(screen.getByLabelText("SSL mode")).toHaveTextContent(/Prefer/);
    });

    it("reflects a stored verify-full posture", () => {
      renderPg({ tlsEnabled: true, trustServerCertificate: false });
      expect(screen.getByLabelText("SSL mode")).toHaveTextContent(
        /Verify full/,
      );
    });

    it("selecting Disable maps to the forced-plaintext combo (tls=false, trust=false)", async () => {
      const user = userEvent.setup();
      const onChange = renderPg({});
      await user.click(screen.getByLabelText("SSL mode"));
      await user.click(screen.getByRole("option", { name: /Disable/ }));
      expect(onChange).toHaveBeenCalledWith({
        tlsEnabled: false,
        trustServerCertificate: false,
      });
    });

    it("selecting Require maps to encrypt-but-skip-verify (tls=true, trust=true)", async () => {
      const user = userEvent.setup();
      const onChange = renderPg({});
      await user.click(screen.getByLabelText("SSL mode"));
      await user.click(screen.getByRole("option", { name: /Require/ }));
      expect(onChange).toHaveBeenCalledWith({
        tlsEnabled: true,
        trustServerCertificate: true,
      });
    });

    it("warns about skipped verification while Require is selected", () => {
      renderPg({ tlsEnabled: true, trustServerCertificate: true });
      // Require = skip-verify: the MITM exposure is surfaced as an alert so the
      // choice is deliberate, not silent.
      expect(
        screen.getByText(/Certificate verification is skipped/),
      ).toBeInTheDocument();
    });

    it("does not warn for Verify full", () => {
      renderPg({ tlsEnabled: true, trustServerCertificate: false });
      expect(
        screen.queryByText(/Certificate verification is skipped/),
      ).not.toBeInTheDocument();
    });
  });
});
