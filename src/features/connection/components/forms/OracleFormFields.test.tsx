import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionDraft } from "@/types/connection";
import OracleFormFields from "./OracleFormFields";

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

/**
 * #2436 — the dialog renders this component once per segment. Oracle splits
 * across `basic` (host/port/user/password/connect method/identifier) and
 * `security` (SSL posture + wallet), so a test spanning the whole Oracle field
 * set stacks both. The two render disjoint controls, so ids and labels stay
 * unique and every assertion below reads the same DOM it read before the split.
 */
function renderForm(
  draft: ConnectionDraft,
  overrides: Partial<
    Omit<React.ComponentProps<typeof OracleFormFields>, "section">
  > = {},
) {
  const props = {
    draft,
    onChange: vi.fn(),
    passwordInput: "",
    setPasswordInput: vi.fn(),
    isEditing: false,
    hadPassword: false,
    clearPassword: false,
    setClearPassword: vi.fn(),
    ...walletProps,
    inputClass: "input",
    labelClass: "label",
    ...overrides,
  };
  return render(
    <>
      <OracleFormFields section="basic" {...props} />
      <OracleFormFields section="security" {...props} />
    </>,
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

  it("offers the TLS postures Oracle can actually dial", () => {
    // Reason: #2154 — wallet-less 1-way TCPS is driven by the shared sslmode
    // posture, so the Oracle form grows the dropdown. `require` is left out:
    // the driver cannot skip certificate verification, so the backend rejects
    // that posture and offering it would only build a draft that fails to
    // connect. (2026-08-12)
    renderForm(makeDraft());

    const select = screen.getByLabelText("SSL mode");
    act(() => {
      fireEvent.keyDown(select, { key: "Enter" });
    });

    expect(screen.getByText("Verify full (encrypt + verify)")).toBeVisible();
    expect(screen.getByText("Disable (no encryption)")).toBeVisible();
    expect(
      screen.queryByText("Require (encrypt, skip verification)"),
    ).not.toBeInTheDocument();
  });

  it("still renders a stored posture the dropdown does not offer", () => {
    // Reason: #2154 — narrowing the option list must not silently rewrite a
    // posture an import or a hand-edited file already stored. `sslModeChoices`
    // re-adds the current value; the backend is what refuses it at connect.
    // (2026-08-12)
    renderForm(makeDraft({ sslMode: "require" }));

    expect(screen.getByLabelText("SSL mode")).toHaveTextContent(
      "Require (encrypt, skip verification)",
    );
  });

  it("hands host, port and connect method to a pasted TNS descriptor", () => {
    // Reason: #2154 — a descriptor names HOST/PORT/CONNECT_DATA itself and the
    // backend dials those, so the inputs it overrides must stop accepting
    // input; leaving them live would show a host the connection never dials.
    // (2026-08-12)
    renderForm(
      makeDraft({
        database:
          "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=dial-host.example.com)(PORT=1522))(CONNECT_DATA=(SERVICE_NAME=svc)))",
      }),
    );

    expect(screen.getByLabelText("Host")).toBeDisabled();
    expect(screen.getByLabelText("Port")).toBeDisabled();
    expect(screen.getByLabelText("Connection method")).toBeDisabled();
    expect(screen.getByLabelText("TNS connect descriptor")).toBeInTheDocument();
    expect(screen.queryByLabelText("Service name")).not.toBeInTheDocument();
  });

  it("keeps host, port and connect method live for a plain service name", () => {
    renderForm(makeDraft());

    expect(screen.getByLabelText("Host")).toBeEnabled();
    expect(screen.getByLabelText("Port")).toBeEnabled();
    expect(screen.getByLabelText("Connection method")).toBeEnabled();
    expect(
      screen.queryByLabelText("TNS connect descriptor"),
    ).not.toBeInTheDocument();
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
