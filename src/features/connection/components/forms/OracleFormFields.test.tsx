import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import OracleFormFields from "./OracleFormFields";
import type { ConnectionDraft } from "@/types/connection";

// Purpose: Oracle connection form — service-name/SID method switch + wallet
// mTLS fields (#1065). (2026-07-17)

function makeDraft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "",
    name: "",
    dbType: "oracle",
    host: "localhost",
    port: 1521,
    user: "system",
    password: null,
    walletPassword: null,
    database: "FREEPDB1",
    groupId: null,
    color: null,
    paradigm: "rdb",
    ...overrides,
  };
}

const walletProps = {
  walletPasswordInput: "",
  setWalletPasswordInput: vi.fn(),
  hadWalletPassword: false,
  clearWalletPassword: false,
  setClearWalletPassword: vi.fn(),
};

function renderForm(
  draft: ConnectionDraft,
  overrides: Partial<React.ComponentProps<typeof OracleFormFields>> = {},
) {
  return render(
    <OracleFormFields
      draft={draft}
      onChange={vi.fn()}
      passwordInput=""
      setPasswordInput={vi.fn()}
      isEditing={false}
      hadPassword={false}
      clearPassword={false}
      setClearPassword={vi.fn()}
      {...walletProps}
      inputClass="input"
      labelClass="label"
      {...overrides}
    />,
  );
}

describe("OracleFormFields", () => {
  it("renders service-name connection fields by default", () => {
    renderForm(makeDraft());

    expect(screen.getByLabelText("Host")).toHaveValue("localhost");
    expect(screen.getByLabelText("Port")).toHaveValue(1521);
    expect(screen.getByLabelText("User")).toHaveValue("system");
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Service name")).toHaveValue("FREEPDB1");
    expect(screen.queryByLabelText("Database")).not.toBeInTheDocument();
  });

  it("stores the Oracle service name in the existing database field", () => {
    const onChange = vi.fn();
    renderForm(makeDraft(), { onChange });

    act(() => {
      fireEvent.change(screen.getByLabelText("Service name"), {
        target: { value: "XEPDB1" },
      });
    });

    expect(onChange).toHaveBeenCalledWith({ database: "XEPDB1" });
  });

  it("labels the identifier field as SID when the SID method is selected", () => {
    // Reason: #1065 — the SID/service switch relabels the same `database`
    // field; SID mode must not render a "Service name" label. (2026-07-17)
    renderForm(makeDraft({ oracleUseSid: true, database: "ORCL" }));

    expect(screen.getByLabelText("SID")).toHaveValue("ORCL");
    expect(screen.queryByLabelText("Service name")).not.toBeInTheDocument();
  });

  it("renders wallet directory + wallet password fields", () => {
    // Reason: #1065 — the wallet path + wallet password inputs enable Oracle
    // Cloud ADB mTLS. (2026-07-17)
    renderForm(makeDraft({ walletPath: "/opt/wallet" }));

    expect(screen.getByLabelText("Wallet directory (optional)")).toHaveValue(
      "/opt/wallet",
    );
    expect(screen.getByLabelText("Wallet password")).toBeInTheDocument();
  });

  it("routes the wallet password into its own input, not the draft", () => {
    // Reason: #1065 — the wallet password follows ADR-0005: it is UI state,
    // never folded into the draft until save. (2026-07-17)
    const setWalletPasswordInput = vi.fn();
    renderForm(makeDraft(), { setWalletPasswordInput });

    act(() => {
      fireEvent.change(screen.getByLabelText("Wallet password"), {
        target: { value: "wsecret" },
      });
    });

    expect(setWalletPasswordInput).toHaveBeenCalledWith("wsecret");
  });
});
