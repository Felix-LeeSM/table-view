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

  // Purpose: #1649 (ADR 0058) — PG's TLS control is the sslmode dropdown, now
  // bound directly to the stored `sslMode` enum (was a view over the boolean
  // pair in #1063) and extended with `verify-ca`, which reveals a CA certificate
  // path input so the server can be validated against a private/self-signed CA.
  describe("sslmode dropdown (#1649)", () => {
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
      renderPg({ sslMode: "verify-full" });
      expect(screen.getByLabelText("SSL mode")).toHaveTextContent(
        /Verify full/,
      );
    });

    it("selecting Disable sets sslMode=disable and clears any CA path", async () => {
      const user = userEvent.setup();
      const onChange = renderPg({});
      await user.click(screen.getByLabelText("SSL mode"));
      await user.click(screen.getByRole("option", { name: /Disable/ }));
      expect(onChange).toHaveBeenCalledWith({
        sslMode: "disable",
        caCertPath: null,
      });
    });

    it("selecting Require sets sslMode=require", async () => {
      const user = userEvent.setup();
      const onChange = renderPg({});
      await user.click(screen.getByLabelText("SSL mode"));
      await user.click(screen.getByRole("option", { name: /Require/ }));
      expect(onChange).toHaveBeenCalledWith({
        sslMode: "require",
        caCertPath: null,
      });
    });

    it("warns about skipped verification while Require is selected", () => {
      renderPg({ sslMode: "require" });
      // Require = skip-verify: the MITM exposure is surfaced as an alert so the
      // choice is deliberate, not silent.
      expect(
        screen.getByText(/Certificate verification is skipped/),
      ).toBeInTheDocument();
    });

    it("does not warn for Verify full", () => {
      renderPg({ sslMode: "verify-full" });
      expect(
        screen.queryByText(/Certificate verification is skipped/),
      ).not.toBeInTheDocument();
    });

    // Reason: #1649 (ADR 0058) — verify-ca is the new advanced posture; the
    // form must expose the CA certificate path input so the feature is actually
    // reachable (the visible-slice acceptance). Hidden for every other posture
    // so a stray CA path is never authored. (2026-07-25)
    it("reveals the CA certificate path input when verify-ca is selected", () => {
      renderPg({ sslMode: "verify-ca", caCertPath: "/etc/ssl/ca.pem" });
      const caInput = screen.getByLabelText(
        "CA certificate file",
      ) as HTMLInputElement;
      expect(caInput).toBeInTheDocument();
      expect(caInput.value).toBe("/etc/ssl/ca.pem");
    });

    it("hides the CA certificate path input for non-verify-ca postures", () => {
      renderPg({ sslMode: "require" });
      expect(
        screen.queryByLabelText("CA certificate file"),
      ).not.toBeInTheDocument();
    });

    it("selecting Verify CA sets sslMode=verify-ca (keeping the CA path key)", async () => {
      const user = userEvent.setup();
      const onChange = renderPg({});
      await user.click(screen.getByLabelText("SSL mode"));
      await user.click(screen.getByRole("option", { name: /Verify CA/ }));
      expect(onChange).toHaveBeenCalledWith({ sslMode: "verify-ca" });
    });

    it("edits the CA path through onChange when verify-ca is active", () => {
      const onChange = renderPg({ sslMode: "verify-ca" });
      act(() => {
        fireEvent.change(screen.getByLabelText("CA certificate file"), {
          target: { value: "/tmp/ca.pem" },
        });
      });
      expect(onChange).toHaveBeenCalledWith({ caCertPath: "/tmp/ca.pem" });
    });
  });
});
