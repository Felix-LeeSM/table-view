import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConnectionDialog from "./ConnectionDialog";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig, ConnectionDraft } from "@/types/connection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnection(
  overrides: Partial<ConnectionConfig> = {},
): ConnectionConfig {
  return {
    id: "conn-1",
    name: "My DB",
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    has_password: true,
    database: "mydb",
    group_id: null,
    color: null,
    environment: null,
    ...overrides,
  };
}

const mockAddConnection = vi
  .fn()
  .mockResolvedValue(makeConnection({ id: "new-id", name: "Test" }));
const mockUpdateConnection = vi.fn().mockResolvedValue(undefined);
const mockTestConnection = vi.fn().mockResolvedValue("Connection successful");

function setStoreState(overrides: Record<string, unknown> = {}) {
  useConnectionStore.setState({
    addConnection: mockAddConnection,
    updateConnection: mockUpdateConnection,
    testConnection: mockTestConnection,
    ...overrides,
  } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);
}

function renderDialog(
  props: { connection?: ConnectionConfig; onClose?: () => void } = {},
) {
  const onClose = props.onClose ?? vi.fn();
  const result = render(
    <ConnectionDialog connection={props.connection} onClose={onClose} />,
  );
  return { ...result, onClose };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConnectionDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddConnection.mockResolvedValue(
      makeConnection({ id: "new-id", name: "Test" }),
    );
    mockUpdateConnection.mockResolvedValue(undefined);
    mockTestConnection.mockResolvedValue("Connection successful");
    setStoreState();
  });

  // -----------------------------------------------------------------------
  // AC-01: Renders "New Connection" header in create mode
  // -----------------------------------------------------------------------
  it("renders New Connection header in create mode", () => {
    renderDialog();
    expect(screen.getByText("New Connection")).toBeInTheDocument();
  });

  it("has role=dialog with proper modal semantics", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("role", "dialog");
  });

  // -----------------------------------------------------------------------
  // AC-02: Renders "Edit Connection" header with pre-filled form
  // -----------------------------------------------------------------------
  it("renders Edit Connection header when connection prop provided", () => {
    renderDialog({ connection: makeConnection() });
    expect(screen.getByText("Edit Connection")).toBeInTheDocument();
  });

  it("pre-fills form fields with connection data in edit mode", () => {
    renderDialog({
      connection: makeConnection({
        name: "Prod DB",
        host: "prod.example.com",
        port: 3306,
      }),
    });

    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Prod DB",
    );
    expect((screen.getByLabelText("Host") as HTMLInputElement).value).toBe(
      "prod.example.com",
    );
    expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
      "3306",
    );
  });

  it("does not show input mode toggle in edit mode", () => {
    renderDialog({ connection: makeConnection() });
    expect(screen.queryByText("Form")).not.toBeInTheDocument();
    expect(screen.queryByText("URL")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-03: Validates required fields (name, host) on save
  // -----------------------------------------------------------------------
  it("shows error when name is empty on save", async () => {
    renderDialog();
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
    expect(mockAddConnection).not.toHaveBeenCalled();
  });

  it("shows error when host is empty on save", async () => {
    renderDialog();
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    const hostInput = screen.getByLabelText("Host") as HTMLInputElement;

    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Test DB" } });
      fireEvent.change(hostInput, { target: { value: "" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Host is required");
    expect(mockAddConnection).not.toHaveBeenCalled();
  });

  it("shows error when name is whitespace-only on save", async () => {
    renderDialog();
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;

    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "   " } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
  });

  // -----------------------------------------------------------------------
  // AC-04: Calls addConnection on save for new connection
  // -----------------------------------------------------------------------
  it("calls addConnection on save for new connection and calls onClose", async () => {
    const { onClose } = renderDialog();

    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    const hostInput = screen.getByLabelText("Host") as HTMLInputElement;

    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "New DB" } });
      fireEvent.change(hostInput, { target: { value: "db.example.com" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    expect(mockAddConnection).toHaveBeenCalledTimes(1);
    const savedDraft = mockAddConnection.mock.calls[0]![0] as ConnectionDraft;
    expect(savedDraft.name).toBe("New DB");
    expect(savedDraft.host).toBe("db.example.com");
    expect(onClose).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // AC-05: Calls updateConnection on save for editing
  // -----------------------------------------------------------------------
  it("calls updateConnection on save when editing existing connection", async () => {
    const conn = makeConnection({ name: "Existing DB" });
    const { onClose } = renderDialog({ connection: conn });

    await act(async () => {
      fireEvent.click(screen.getByText("Update"));
    });

    expect(mockUpdateConnection).toHaveBeenCalledTimes(1);
    const draft = mockUpdateConnection.mock.calls[0]![0] as ConnectionDraft;
    expect(draft.name).toBe("Existing DB");
    expect(draft.id).toBe(conn.id);
    // Editing with empty input + has_password=true → password is null (keep)
    expect(draft.password).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows Update button text in edit mode", () => {
    renderDialog({ connection: makeConnection() });
    expect(screen.getByText("Update")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-06: Test Connection button triggers testConnection and shows result
  // -----------------------------------------------------------------------
  it("shows success result when test connection succeeds", async () => {
    renderDialog();

    await act(async () => {
      fireEvent.click(screen.getByText("Test Connection"));
    });

    await waitFor(() => {
      expect(screen.getByText("Connection successful")).toBeInTheDocument();
    });
    expect(mockTestConnection).toHaveBeenCalledTimes(1);
  });

  it("shows error result when test connection fails", async () => {
    mockTestConnection.mockRejectedValue(new Error("Connection refused"));

    renderDialog();

    await act(async () => {
      fireEvent.click(screen.getByText("Test Connection"));
    });

    await waitFor(() => {
      expect(screen.getByText("Error: Connection refused")).toBeInTheDocument();
    });
  });

  it("disables Test Connection button while testing", () => {
    // Never resolve to keep testing state
    mockTestConnection.mockReturnValue(new Promise(() => {}));

    renderDialog();

    act(() => {
      fireEvent.click(screen.getByText("Test Connection"));
    });

    expect(
      screen.getByText("Test Connection").closest("button"),
    ).toBeDisabled();
    // Spinner should be visible
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-07: URL mode parses URL and populates form
  // -----------------------------------------------------------------------
  it("switches to URL input mode on URL toggle click", async () => {
    renderDialog();

    await act(async () => {
      fireEvent.click(screen.getByText("URL"));
    });

    expect(screen.getByLabelText("Connection URL")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("parses valid URL and populates form fields", async () => {
    renderDialog();

    // Switch to URL mode
    await act(async () => {
      fireEvent.click(screen.getByText("URL"));
    });

    const urlInput = screen.getByLabelText(
      "Connection URL",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(urlInput, {
        target: {
          value: "postgresql://admin:pass123@db.example.com:5432/myapp",
        },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Parse & Continue"));
    });

    // Should switch back to form mode with parsed values
    const hostInput = screen.getByLabelText("Host") as HTMLInputElement;
    expect(hostInput.value).toBe("db.example.com");

    const portInput = screen.getByLabelText("Port") as HTMLInputElement;
    expect(portInput.value).toBe("5432");

    const userInput = screen.getByLabelText("User") as HTMLInputElement;
    expect(userInput.value).toBe("admin");

    const dbInput = screen.getByLabelText("Database") as HTMLInputElement;
    expect(dbInput.value).toBe("myapp");
  });

  it("shows error for invalid URL format", async () => {
    renderDialog();

    await act(async () => {
      fireEvent.click(screen.getByText("URL"));
    });

    const urlInput = screen.getByLabelText(
      "Connection URL",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(urlInput, { target: { value: "not-a-valid-url" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Parse & Continue"));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Invalid URL");
  });

  it("uses database name as connection name when name is empty", async () => {
    renderDialog();

    await act(async () => {
      fireEvent.click(screen.getByText("URL"));
    });

    const urlInput = screen.getByLabelText(
      "Connection URL",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(urlInput, {
        target: { value: "postgresql://user:pass@host:5432/myapp" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Parse & Continue"));
    });

    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("myapp");
  });

  it("preserves existing name when parsing URL", async () => {
    renderDialog();

    // Set a name first
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "My Custom Name" } });
    });

    // Switch to URL mode
    await act(async () => {
      fireEvent.click(screen.getByText("URL"));
    });

    const urlInput = screen.getByLabelText(
      "Connection URL",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(urlInput, {
        target: { value: "postgresql://user:pass@host:5432/myapp" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Parse & Continue"));
    });

    const updatedNameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(updatedNameInput.value).toBe("My Custom Name");
  });

  // -----------------------------------------------------------------------
  // AC-08: Closes on Escape key
  // -----------------------------------------------------------------------
  it("closes on Escape key press", () => {
    const { onClose } = renderDialog();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on non-Escape key press", () => {
    const { onClose } = renderDialog();

    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: "Tab" });

    expect(onClose).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Additional coverage: dialog close button, cancel button, form interactions
  // -----------------------------------------------------------------------
  it("closes on X button click", async () => {
    const { onClose } = renderDialog();
    const closeBtn = screen.getByLabelText("Close dialog");
    await act(async () => {
      fireEvent.click(closeBtn);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Cancel button click", async () => {
    const { onClose } = renderDialog();
    await act(async () => {
      fireEvent.click(screen.getByText("Cancel"));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("updates database type and port when selecting MySQL", async () => {
    renderDialog();

    const select = screen.getByLabelText("Database Type") as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: "mysql" } });
    });

    expect(select.value).toBe("mysql");
    const portInput = screen.getByLabelText("Port") as HTMLInputElement;
    expect(portInput.value).toBe("3306");
  });

  it("updates database type and port when selecting MongoDB", async () => {
    renderDialog();

    const select = screen.getByLabelText("Database Type") as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: "mongodb" } });
    });

    const portInput = screen.getByLabelText("Port") as HTMLInputElement;
    expect(portInput.value).toBe("27017");
  });

  it("updates form fields when typing", async () => {
    const user = userEvent.setup();
    renderDialog();

    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, "Typed Name");

    expect(nameInput.value).toBe("Typed Name");
  });

  it("shows Saving... text while saving", async () => {
    // Never resolve to keep saving state
    mockAddConnection.mockReturnValue(new Promise(() => {}));

    renderDialog();

    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Test" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });

  it("shows error alert when save fails", async () => {
    mockAddConnection.mockRejectedValue(new Error("Save failed"));

    renderDialog();

    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Test" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Save failed");
    });
  });

  it("clears error when attempting save again after validation error", async () => {
    renderDialog();

    // First save attempt with empty name shows error
    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });
    expect(screen.getByText("Name is required")).toBeInTheDocument();

    // Fill in name and host, then save again
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Valid Name" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    // The validation error should be gone (new error or no error)
    expect(screen.queryByText("Name is required")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Sprint 59: Environment select field
  // -----------------------------------------------------------------------
  it("renders Environment select field with default None", () => {
    renderDialog();
    const select = screen.getByLabelText("Environment") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe("");
  });

  it("renders all environment options", () => {
    renderDialog();
    const select = screen.getByLabelText("Environment") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("");
    expect(options).toContain("local");
    expect(options).toContain("testing");
    expect(options).toContain("development");
    expect(options).toContain("staging");
    expect(options).toContain("production");
  });

  it("pre-selects environment when editing connection with environment", () => {
    renderDialog({
      connection: makeConnection({ environment: "production" }),
    });
    const select = screen.getByLabelText("Environment") as HTMLSelectElement;
    expect(select.value).toBe("production");
  });

  it("pre-selects empty when editing connection without environment", () => {
    renderDialog({ connection: makeConnection({ environment: null }) });
    const select = screen.getByLabelText("Environment") as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  it("updates environment in form state when selecting an option", async () => {
    renderDialog();
    const select = screen.getByLabelText("Environment") as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: "staging" } });
    });
    expect(select.value).toBe("staging");
  });

  it("sets environment to null when selecting None option", async () => {
    renderDialog({
      connection: makeConnection({ environment: "production" }),
    });
    const select = screen.getByLabelText("Environment") as HTMLSelectElement;
    expect(select.value).toBe("production");

    await act(async () => {
      fireEvent.change(select, { target: { value: "" } });
    });
    expect(select.value).toBe("");
  });

  it("includes environment in saved form data", async () => {
    renderDialog();
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    const envSelect = screen.getByLabelText("Environment") as HTMLSelectElement;

    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Test DB" } });
      fireEvent.change(envSelect, { target: { value: "local" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    expect(mockAddConnection).toHaveBeenCalledTimes(1);
    const savedDraft = mockAddConnection.mock.calls[0]![0] as ConnectionDraft;
    expect(savedDraft.environment).toBe("local");
  });

  // -----------------------------------------------------------------------
  // Phase B-2: password security UX
  // -----------------------------------------------------------------------
  describe("Password handling", () => {
    it("password input starts empty when editing a connection with a stored password", () => {
      renderDialog({ connection: makeConnection({ has_password: true }) });
      const pw = screen.getByLabelText("Password") as HTMLInputElement;
      expect(pw.value).toBe("");
      expect(pw.placeholder).toMatch(/leave blank to keep current password/i);
    });

    it("shows 'Password set' badge when has_password is true", () => {
      renderDialog({ connection: makeConnection({ has_password: true }) });
      expect(screen.getByTestId("password-status-badge")).toHaveTextContent(
        /password set/i,
      );
    });

    it("shows 'No password' badge when has_password is false", () => {
      renderDialog({ connection: makeConnection({ has_password: false }) });
      expect(screen.getByTestId("password-status-badge")).toHaveTextContent(
        /no password/i,
      );
    });

    it("editing + empty input + Update → sends password: null (preserve)", async () => {
      renderDialog({ connection: makeConnection({ has_password: true }) });

      await act(async () => {
        fireEvent.click(screen.getByText("Update"));
      });

      const draft = mockUpdateConnection.mock.calls[0]![0] as ConnectionDraft;
      expect(draft.password).toBeNull();
    });

    it("editing + new password typed + Update → sends new password", async () => {
      renderDialog({ connection: makeConnection({ has_password: true }) });

      const pw = screen.getByLabelText("Password") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(pw, { target: { value: "fresh-pw" } });
      });
      await act(async () => {
        fireEvent.click(screen.getByText("Update"));
      });

      const draft = mockUpdateConnection.mock.calls[0]![0] as ConnectionDraft;
      expect(draft.password).toBe("fresh-pw");
    });

    it("editing + Clear password checked → sends empty string", async () => {
      renderDialog({ connection: makeConnection({ has_password: true }) });

      const clearCheckbox = screen.getByLabelText(
        /clear stored password on save/i,
      ) as HTMLInputElement;
      await act(async () => {
        fireEvent.click(clearCheckbox);
      });
      await act(async () => {
        fireEvent.click(screen.getByText("Update"));
      });

      const draft = mockUpdateConnection.mock.calls[0]![0] as ConnectionDraft;
      expect(draft.password).toBe("");
    });

    it("Clear password checkbox disables the password input and clears it", async () => {
      renderDialog({ connection: makeConnection({ has_password: true }) });

      const pw = screen.getByLabelText("Password") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(pw, { target: { value: "willbecleared" } });
      });
      const clearCheckbox = screen.getByLabelText(
        /clear stored password on save/i,
      ) as HTMLInputElement;
      await act(async () => {
        fireEvent.click(clearCheckbox);
      });

      expect(pw).toBeDisabled();
      expect(pw.value).toBe("");
    });

    it("Test Connection while editing forwards existingId", async () => {
      const conn = makeConnection({ id: "to-test", has_password: true });
      renderDialog({ connection: conn });

      await act(async () => {
        fireEvent.click(screen.getByText("Test Connection"));
      });

      expect(mockTestConnection).toHaveBeenCalledTimes(1);
      const args = mockTestConnection.mock.calls[0]!;
      expect(args[1]).toBe("to-test");
    });

    it("does not show the Clear password checkbox when has_password is false", () => {
      renderDialog({ connection: makeConnection({ has_password: false }) });
      expect(
        screen.queryByLabelText(/clear stored password on save/i),
      ).toBeNull();
    });
  });
});
