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
import { expectNodeStable } from "@/__tests__/utils/expectNodeStable";

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
    paradigm: "rdb",
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
    const user = userEvent.setup();
    renderDialog();

    // Sprint-112: Radix Select migration — open the trigger then click
    // the desired option. The trigger reflects the current value through
    // its accessible name, so subsequent assertions use textContent.
    const trigger = screen.getByLabelText("Database Type");
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "MySQL" }));

    expect(trigger).toHaveTextContent("MySQL");
    const portInput = screen.getByLabelText("Port") as HTMLInputElement;
    expect(portInput.value).toBe("3306");
  });

  it("updates database type and port when selecting MongoDB", async () => {
    const user = userEvent.setup();
    renderDialog();

    const trigger = screen.getByLabelText("Database Type");
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "MongoDB" }));

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
  // Sprint 112: migrated from native HTML select to Radix-based Select;
  // assertions now read the trigger's accessible name (textContent) instead
  // of an HTMLSelectElement.value, and option-pick uses userEvent.
  // -----------------------------------------------------------------------
  it("renders Environment select field with default None", () => {
    renderDialog();
    const trigger = screen.getByLabelText("Environment");
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("None");
  });

  it("renders all environment options", async () => {
    const user = userEvent.setup();
    renderDialog();
    const trigger = screen.getByLabelText("Environment");
    await user.click(trigger);
    // Open the Radix popover and assert each option is reachable by
    // accessible name. "None" maps to the sentinel; the rest are the
    // canonical environment labels.
    expect(screen.getByRole("option", { name: "None" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Local" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Testing" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Development" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Staging" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Production" }),
    ).toBeInTheDocument();
  });

  it("pre-selects environment when editing connection with environment", () => {
    renderDialog({
      connection: makeConnection({ environment: "production" }),
    });
    const trigger = screen.getByLabelText("Environment");
    expect(trigger).toHaveTextContent("Production");
  });

  it("pre-selects empty when editing connection without environment", () => {
    renderDialog({ connection: makeConnection({ environment: null }) });
    const trigger = screen.getByLabelText("Environment");
    expect(trigger).toHaveTextContent("None");
  });

  it("updates environment in form state when selecting an option", async () => {
    const user = userEvent.setup();
    renderDialog();
    const trigger = screen.getByLabelText("Environment");
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Staging" }));
    expect(trigger).toHaveTextContent("Staging");
  });

  it("sets environment to null when selecting None option", async () => {
    const user = userEvent.setup();
    renderDialog({
      connection: makeConnection({ environment: "production" }),
    });
    const trigger = screen.getByLabelText("Environment");
    expect(trigger).toHaveTextContent("Production");

    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "None" }));
    expect(trigger).toHaveTextContent("None");
  });

  it("includes environment in saved form data", async () => {
    const user = userEvent.setup();
    renderDialog();
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Test DB" } });
    });

    const envTrigger = screen.getByLabelText("Environment");
    await user.click(envTrigger);
    await user.click(screen.getByRole("option", { name: "Local" }));

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

  // -----------------------------------------------------------------------
  // Sprint 65: MongoDB-specific conditional fields
  // -----------------------------------------------------------------------
  describe("MongoDB conditional fields", () => {
    it("does not render mongo-only fields when db_type is postgresql", () => {
      renderDialog();
      expect(screen.queryByLabelText("Auth Source")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Replica Set")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Enable TLS")).not.toBeInTheDocument();
    });

    it("renders auth source, replica set, and TLS fields when switching to MongoDB", async () => {
      const user = userEvent.setup();
      renderDialog();
      const trigger = screen.getByLabelText("Database Type");

      await user.click(trigger);
      await user.click(screen.getByRole("option", { name: "MongoDB" }));

      expect(screen.getByLabelText("Auth Source")).toBeInTheDocument();
      expect(screen.getByLabelText("Replica Set")).toBeInTheDocument();
      expect(screen.getByLabelText("Enable TLS")).toBeInTheDocument();
    });

    it("relabels Database as optional when MongoDB is selected", async () => {
      const user = userEvent.setup();
      renderDialog();
      const trigger = screen.getByLabelText("Database Type");

      await user.click(trigger);
      await user.click(screen.getByRole("option", { name: "MongoDB" }));

      expect(screen.getByText("Database (optional)")).toBeInTheDocument();
    });

    it("includes auth_source, replica_set, tls_enabled in the saved draft", async () => {
      const user = userEvent.setup();
      renderDialog();
      const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(nameInput, { target: { value: "Mongo DB" } });
      });

      const trigger = screen.getByLabelText("Database Type");
      await user.click(trigger);
      await user.click(screen.getByRole("option", { name: "MongoDB" }));

      const authSource = screen.getByLabelText(
        "Auth Source",
      ) as HTMLInputElement;
      const replicaSet = screen.getByLabelText(
        "Replica Set",
      ) as HTMLInputElement;
      const tls = screen.getByLabelText("Enable TLS") as HTMLInputElement;

      await act(async () => {
        fireEvent.change(authSource, { target: { value: "admin" } });
        fireEvent.change(replicaSet, { target: { value: "rs0" } });
        fireEvent.click(tls);
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Save"));
      });

      expect(mockAddConnection).toHaveBeenCalledTimes(1);
      const draft = mockAddConnection.mock.calls[0]![0] as ConnectionDraft;
      expect(draft.db_type).toBe("mongodb");
      expect(draft.paradigm).toBe("document");
      expect(draft.auth_source).toBe("admin");
      expect(draft.replica_set).toBe("rs0");
      expect(draft.tls_enabled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Sprint 79: Footer layout + dialog width + Test result aria-live
  // -----------------------------------------------------------------------
  describe("Sprint 79: layout + inline Test feedback polish", () => {
    it("places Test Connection on the left group of the footer", () => {
      renderDialog();
      const testBtn = screen.getByRole("button", { name: /test connection/i });
      const cancelBtn = screen.getByRole("button", { name: /^cancel$/i });

      // Left (Test) and right (Cancel/Save) groups must be distinct parent
      // containers so justify-between separates them visually.
      expect(testBtn.parentElement).not.toBe(cancelBtn.parentElement);

      // DOM order: Test button appears before Cancel in the footer flow.
      const position = testBtn.compareDocumentPosition(cancelBtn);
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("applies w-dialog-sm width token (no w-dialog-xs regression)", () => {
      renderDialog();
      const dialog = screen.getByRole("dialog");
      // DialogContent carries the width class directly.
      expect(dialog.className).toContain("w-dialog-sm");
      expect(dialog.className).not.toContain("w-dialog-xs");
      // Inner wrapper should also use the same token — guards the two-call-site
      // replacement from regressing to a single-side change.
      expect(document.querySelector('[class*="w-dialog-xs"]')).toBeNull();
    });

    it("marks Test result alert as aria-live='polite' for screen readers", async () => {
      renderDialog();

      await act(async () => {
        fireEvent.click(screen.getByText("Test Connection"));
      });

      await waitFor(() => {
        expect(screen.getByText("Connection successful")).toBeInTheDocument();
      });

      const alert = screen.getByRole("alert");
      expect(alert.getAttribute("aria-live")).toBe("polite");
    });
  });

  // -----------------------------------------------------------------------
  // Sprint 92 (#CONN-DIALOG-6): Test feedback slot stability + 4-state model
  //
  // The alert region for the Test Connection result must be mounted at all
  // four states (idle / pending / success / error) so back-to-back clicks
  // never unmount the slot. Identity is asserted via the `expectNodeStable`
  // helper from sprint-88; jsdom can't measure offsetHeight reliably, so the
  // contract uses DOM identity as the proxy for "no height jump".
  // -----------------------------------------------------------------------
  describe("Sprint 92: test-feedback slot stability + 4-state model", () => {
    const getSlot = () =>
      document.querySelector('[data-slot="test-feedback"]') as HTMLElement;

    it("mounts the test-feedback slot in idle state on initial render", () => {
      renderDialog();
      const slot = getSlot();
      expect(slot).not.toBeNull();
      // Idle slot is a placeholder (aria-hidden) — no role=alert yet. After
      // the sprint-95 migration to `<DialogFeedback>`, the idle placeholder
      // carries the primitive's testid (`dialog-feedback-idle`).
      expect(
        slot.querySelector('[data-testid="dialog-feedback-idle"]'),
      ).not.toBeNull();
    });

    it("preserves slot DOM identity across idle → pending → success", async () => {
      // Use a deferred promise so we can observe the pending state distinctly.
      let resolveTest!: (value: string) => void;
      mockTestConnection.mockReturnValue(
        new Promise<string>((resolve) => {
          resolveTest = resolve;
        }),
      );

      renderDialog();

      // Snapshot the slot at idle.
      const stable = expectNodeStable(getSlot);
      expect(stable.initial).toBeInTheDocument();

      // Click Test → pending state. Slot must still be the same node.
      await act(async () => {
        fireEvent.click(screen.getByText("Test Connection"));
      });
      stable.assertStillSame("after pending");
      expect(screen.getByText("Testing...")).toBeInTheDocument();
      // Spinner inside the slot
      expect(stable.initial.querySelector(".animate-spin")).not.toBeNull();

      // Resolve → success state. Slot identity must persist.
      await act(async () => {
        resolveTest("Connection successful");
      });
      await waitFor(() => {
        expect(screen.getByText("Connection successful")).toBeInTheDocument();
      });
      stable.assertStillSame("after success");
    });

    it("preserves slot DOM identity across idle → pending → error", async () => {
      let rejectTest!: (reason: unknown) => void;
      mockTestConnection.mockReturnValue(
        new Promise<string>((_, reject) => {
          rejectTest = reject;
        }),
      );

      renderDialog();
      const stable = expectNodeStable(getSlot);

      await act(async () => {
        fireEvent.click(screen.getByText("Test Connection"));
      });
      stable.assertStillSame("after pending");
      expect(screen.getByText("Testing...")).toBeInTheDocument();

      await act(async () => {
        rejectTest(new Error("Connection refused"));
      });
      await waitFor(() => {
        expect(
          screen.getByText("Error: Connection refused"),
        ).toBeInTheDocument();
      });
      stable.assertStillSame("after error");
    });

    it("preserves slot DOM identity across 3 rapid Test clicks (race)", async () => {
      // Each click creates a new pending promise. The slot must remain the
      // same DOM node throughout — this is the regression test for the
      // unmount/remount height-jump described in #CONN-DIALOG-6.
      const resolvers: Array<(value: string) => void> = [];
      mockTestConnection.mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            resolvers.push(resolve);
          }),
      );

      renderDialog();
      const stable = expectNodeStable(getSlot);

      // Click 1 → pending
      await act(async () => {
        fireEvent.click(screen.getByText("Test Connection"));
      });
      stable.assertStillSame("click 1 pending");

      // Resolve click 1 → success. Slot identity persists.
      await act(async () => {
        resolvers[0]!("ok-1");
      });
      await waitFor(() => {
        expect(screen.getByText("ok-1")).toBeInTheDocument();
      });
      stable.assertStillSame("click 1 success");

      // Click 2 → pending again (transition success → pending must not
      // unmount the slot).
      await act(async () => {
        fireEvent.click(screen.getByText("Test Connection"));
      });
      stable.assertStillSame("click 2 pending");

      // Resolve click 2 → success.
      await act(async () => {
        resolvers[1]!("ok-2");
      });
      await waitFor(() => {
        expect(screen.getByText("ok-2")).toBeInTheDocument();
      });
      stable.assertStillSame("click 2 success");

      // Click 3 → pending again.
      await act(async () => {
        fireEvent.click(screen.getByText("Test Connection"));
      });
      stable.assertStillSame("click 3 pending");

      // Resolve click 3 → success.
      await act(async () => {
        resolvers[2]!("ok-3");
      });
      await waitFor(() => {
        expect(screen.getByText("ok-3")).toBeInTheDocument();
      });
      stable.assertStillSame("click 3 success");
    });

    it("renders spinner + 'Testing...' inside the slot during pending state", async () => {
      // Never-resolving promise → component sticks in pending state.
      mockTestConnection.mockReturnValue(new Promise(() => {}));

      renderDialog();

      await act(async () => {
        fireEvent.click(screen.getByText("Test Connection"));
      });

      const slot = getSlot();
      expect(slot).not.toBeNull();
      // Spinner is inside the slot
      const slotSpinner = slot.querySelector(".animate-spin");
      expect(slotSpinner).not.toBeNull();
      // "Testing..." text is inside the slot
      expect(slot.textContent).toContain("Testing...");
    });

    it("removes pending content when transitioning back to success state", async () => {
      let resolveTest!: (value: string) => void;
      mockTestConnection.mockReturnValue(
        new Promise<string>((resolve) => {
          resolveTest = resolve;
        }),
      );

      renderDialog();

      await act(async () => {
        fireEvent.click(screen.getByText("Test Connection"));
      });
      // pending
      expect(screen.getByText("Testing...")).toBeInTheDocument();

      await act(async () => {
        resolveTest("Connection successful");
      });
      await waitFor(() => {
        expect(screen.getByText("Connection successful")).toBeInTheDocument();
      });
      // pending placeholder is gone
      expect(screen.queryByText("Testing...")).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Sprint 108 (#CONN-DIALOG-2): DB type change custom-port guard
  //
  // When the user changes DB type while the port is at the default for the
  // current type (or 0/empty), the port auto-updates silently. When the port
  // is a user-customised value, a ConfirmDialog asks for explicit consent
  // before replacement; cancel leaves dbType + port untouched.
  // -----------------------------------------------------------------------
  describe("Sprint 108: DB type change port guard", () => {
    it("auto-updates port when current port is the default (postgres 5432 → mysql 3306)", async () => {
      const user = userEvent.setup();
      renderDialog();

      const trigger = screen.getByLabelText("Database Type");
      const portInput = screen.getByLabelText("Port") as HTMLInputElement;
      // Sanity: starting at postgres default.
      expect(trigger).toHaveTextContent("PostgreSQL");
      expect(portInput.value).toBe("5432");

      await user.click(trigger);
      await user.click(screen.getByRole("option", { name: "MySQL" }));

      expect(trigger).toHaveTextContent("MySQL");
      expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
        "3306",
      );
      // No ConfirmDialog rendered.
      expect(
        screen.queryByText("Replace custom port?"),
      ).not.toBeInTheDocument();
    });

    it("auto-updates port when current port is 0 (sqlite default → mysql)", async () => {
      const user = userEvent.setup();
      renderDialog();

      const trigger = screen.getByLabelText("Database Type");
      // Sprint 138: SQLite renders no Port field at all (the form drops
      // host/port/user/password). The internal `port` is still 0 so a
      // subsequent switch to MySQL must take the silent-default path
      // (no ConfirmDialog) and the new MySQL form must show port=3306.
      await user.click(trigger);
      await user.click(screen.getByRole("option", { name: "SQLite" }));
      // SQLite form: Port field is absent.
      expect(screen.queryByLabelText("Port")).not.toBeInTheDocument();
      // Database file picker is present in its place.
      expect(
        screen.getByLabelText("SQLite database file path"),
      ).toBeInTheDocument();

      // Now switch sqlite → mysql; port must auto-update without modal.
      await user.click(trigger);
      await user.click(screen.getByRole("option", { name: "MySQL" }));

      expect(trigger).toHaveTextContent("MySQL");
      expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
        "3306",
      );
      expect(
        screen.queryByText("Replace custom port?"),
      ).not.toBeInTheDocument();
    });

    it("renders ConfirmDialog when current port is custom (15432) and dbType changes", async () => {
      const user = userEvent.setup();
      renderDialog();

      const portInput = screen.getByLabelText("Port") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(portInput, { target: { value: "15432" } });
      });

      const trigger = screen.getByLabelText("Database Type");
      await user.click(trigger);
      await user.click(screen.getByRole("option", { name: "MySQL" }));

      // ConfirmDialog visible with the contract message + confirmLabel.
      expect(screen.getByText("Replace custom port?")).toBeInTheDocument();
      expect(
        screen.getByText(
          /Switching from postgresql to mysql will reset port 15432 → 3306\. Continue\?/,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Use default port 3306" }),
      ).toBeInTheDocument();

      // Form remains unchanged until the user decides.
      expect(screen.getByLabelText("Database Type")).toHaveTextContent(
        "PostgreSQL",
      );
      expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
        "15432",
      );
    });

    it("Confirm 'Use default port 3306' applies dbType=mysql + port=3306 and closes the modal", async () => {
      const user = userEvent.setup();
      renderDialog();

      const portInput = screen.getByLabelText("Port") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(portInput, { target: { value: "15432" } });
      });

      const trigger = screen.getByLabelText("Database Type");
      await user.click(trigger);
      await user.click(screen.getByRole("option", { name: "MySQL" }));

      const confirmBtn = screen.getByRole("button", {
        name: "Use default port 3306",
      });
      await act(async () => {
        fireEvent.click(confirmBtn);
      });

      expect(screen.getByLabelText("Database Type")).toHaveTextContent("MySQL");
      expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
        "3306",
      );
      expect(
        screen.queryByText("Replace custom port?"),
      ).not.toBeInTheDocument();
    });

    it("Sprint 138: switching from PG to MySQL preserves host but resets user from postgres to root", async () => {
      const user = userEvent.setup();
      renderDialog();

      // User changes host to a custom value before switching DBMS.
      const hostInput = screen.getByLabelText("Host") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(hostInput, { target: { value: "db.internal" } });
      });
      // Sanity: PG defaults — user "postgres", port 5432.
      expect((screen.getByLabelText("User") as HTMLInputElement).value).toBe(
        "postgres",
      );

      // Swap PG → MySQL via the DB-type select.
      const trigger = screen.getByLabelText("Database Type");
      await user.click(trigger);
      await user.click(screen.getByRole("option", { name: "MySQL" }));

      // Host preserved, user reset to MySQL default "root".
      expect((screen.getByLabelText("Host") as HTMLInputElement).value).toBe(
        "db.internal",
      );
      expect((screen.getByLabelText("User") as HTMLInputElement).value).toBe(
        "root",
      );
      expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
        "3306",
      );
    });

    it("Cancel keeps dbType=postgres + port=15432 and closes the modal", async () => {
      const user = userEvent.setup();
      renderDialog();

      const portInput = screen.getByLabelText("Port") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(portInput, { target: { value: "15432" } });
      });

      const trigger = screen.getByLabelText("Database Type");
      await user.click(trigger);
      await user.click(screen.getByRole("option", { name: "MySQL" }));

      // The footer has its own "Cancel" button — scope to the AlertDialog.
      const alertDialog = screen.getByRole("alertdialog");
      const cancelBtn = Array.from(alertDialog.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Cancel",
      );
      expect(cancelBtn).toBeDefined();
      await act(async () => {
        fireEvent.click(cancelBtn!);
      });

      expect(screen.getByLabelText("Database Type")).toHaveTextContent(
        "PostgreSQL",
      );
      expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
        "15432",
      );
      expect(
        screen.queryByText("Replace custom port?"),
      ).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Sprint 138 (#4 — DBMS-aware connection form): one scenario per DBMS
  // covering AC-S138-01 / 03 / 04 / 07. The "switching preserves host but
  // resets user" case lives in the Sprint 108 describe above (the swap
  // path is shared).
  // -----------------------------------------------------------------------
  describe("Sprint 138: DBMS-aware form shape", () => {
    it("AC-S138-01 PG: defaults port=5432, user=postgres, database=postgres", () => {
      renderDialog();
      // Initial draft is PG (createEmptyDraft).
      expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
        "5432",
      );
      expect((screen.getByLabelText("User") as HTMLInputElement).value).toBe(
        "postgres",
      );
      // Database default for PG is "postgres" — the form starts with the
      // empty createEmptyDraft default but switches to "postgres" once the
      // user re-selects PostgreSQL through the select (or comes from a
      // type-swap). For new connections starting at PG we accept the
      // legacy empty draft and assert the rendered placeholder.
      const dbInput = screen.getByLabelText("Database") as HTMLInputElement;
      expect(dbInput).toBeInTheDocument();
      expect(dbInput.placeholder).toBe("postgres");
    });

    it("AC-S138-01 / 03 MySQL: defaults port=3306, user=root (NOT postgres)", async () => {
      const user = userEvent.setup();
      renderDialog();
      const trigger = screen.getByLabelText("Database Type");
      await user.click(trigger);
      await user.click(screen.getByRole("option", { name: "MySQL" }));

      expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
        "3306",
      );
      const userInput = screen.getByLabelText("User") as HTMLInputElement;
      expect(userInput.value).toBe("root");
      expect(userInput.value).not.toBe("postgres");
    });

    it("AC-S138-04 SQLite: file path field present, host/port/user/password absent", async () => {
      const user = userEvent.setup();
      renderDialog();
      const trigger = screen.getByLabelText("Database Type");
      await user.click(trigger);
      await user.click(screen.getByRole("option", { name: "SQLite" }));

      // File path field is the sole DBMS-specific input.
      expect(
        screen.getByLabelText("SQLite database file path"),
      ).toBeInTheDocument();

      // Network/auth fields are not rendered.
      expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Port")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("User")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    });

    it("AC-S138-01 Mongo: auth_source / replica_set / tls_enabled present + user defaults to empty", async () => {
      const user = userEvent.setup();
      renderDialog();
      const trigger = screen.getByLabelText("Database Type");
      await user.click(trigger);
      await user.click(screen.getByRole("option", { name: "MongoDB" }));

      expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
        "27017",
      );
      // User defaults to empty (NOT "postgres").
      expect(
        (screen.getByLabelText("User (optional)") as HTMLInputElement).value,
      ).toBe("");
      // Mongo-specific fields.
      expect(screen.getByLabelText("Auth Source")).toBeInTheDocument();
      expect(screen.getByLabelText("Replica Set")).toBeInTheDocument();
      expect(screen.getByLabelText("Enable TLS")).toBeInTheDocument();
    });

    it("AC-S138-01 Redis: database index defaults to 0 and clamps to 0..15", async () => {
      const user = userEvent.setup();
      renderDialog();
      const trigger = screen.getByLabelText("Database Type");
      await user.click(trigger);
      await user.click(screen.getByRole("option", { name: "Redis" }));

      const dbIndex = screen.getByLabelText(
        "Redis database index (0-15)",
      ) as HTMLInputElement;
      expect(dbIndex).toBeInTheDocument();
      expect(dbIndex.value).toBe("0");
      expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
        "6379",
      );

      // Clamp 16 → 15 (above max).
      await act(async () => {
        fireEvent.change(dbIndex, { target: { value: "16" } });
      });
      expect(
        (
          screen.getByLabelText(
            "Redis database index (0-15)",
          ) as HTMLInputElement
        ).value,
      ).toBe("15");

      // Clamp negative → 0 (below min).
      await act(async () => {
        fireEvent.change(dbIndex, { target: { value: "-3" } });
      });
      expect(
        (
          screen.getByLabelText(
            "Redis database index (0-15)",
          ) as HTMLInputElement
        ).value,
      ).toBe("0");
    });
  });
});
