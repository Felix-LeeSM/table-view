import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SnippetsPanel from "./SnippetsPanel";
import {
  useSnippetsStore,
  __resetSnippetCounterForTests,
} from "@stores/snippetsStore";

vi.mock("lucide-react", () => ({
  Code2: () => <span data-testid="icon-code" />,
  Trash2: () => <span data-testid="icon-trash" />,
  Save: () => <span data-testid="icon-save" />,
  X: () => <span data-testid="icon-x" />,
  ArrowLeft: () => <span data-testid="icon-back" />,
}));

describe("SnippetsPanel", () => {
  const onInsert = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    useSnippetsStore.setState({ snippets: [] });
    __resetSnippetCounterForTests();
    vi.clearAllMocks();
  });

  it("renders the empty state when there are no snippets", () => {
    render(
      <SnippetsPanel currentSql="" onInsert={onInsert} onClose={onClose} />,
    );
    expect(screen.getByText("Snippets")).toBeInTheDocument();
    expect(screen.getByText("No snippets yet")).toBeInTheDocument();
  });

  it("saves the current query as a snippet", () => {
    render(
      <SnippetsPanel
        currentSql="SELECT * FROM users"
        onInsert={onInsert}
        onClose={onClose}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Snippet name..."), {
      target: { value: "all users" },
    });
    fireEvent.click(screen.getByLabelText("Save current query as snippet"));
    const { snippets } = useSnippetsStore.getState();
    expect(snippets).toHaveLength(1);
    expect(snippets[0]).toMatchObject({
      name: "all users",
      body: "SELECT * FROM users",
    });
  });

  it("inserts a placeholder-free snippet directly and closes", () => {
    useSnippetsStore.getState().addSnippet("ping", "SELECT 1");
    render(
      <SnippetsPanel currentSql="" onInsert={onInsert} onClose={onClose} />,
    );
    fireEvent.click(screen.getByLabelText("Insert snippet: ping"));
    expect(onInsert).toHaveBeenCalledWith("SELECT 1");
    expect(onClose).toHaveBeenCalled();
  });

  it("prompts for variables before inserting a snippet with placeholders", () => {
    useSnippetsStore
      .getState()
      .addSnippet("byId", "SELECT * FROM {{table}} WHERE id = {{id}}");
    render(
      <SnippetsPanel currentSql="" onInsert={onInsert} onClose={onClose} />,
    );

    // Selecting the snippet opens the fill form instead of inserting.
    fireEvent.click(screen.getByLabelText("Insert snippet: byId"));
    expect(onInsert).not.toHaveBeenCalled();
    expect(screen.getByText("Fill in byId")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Value for table"), {
      target: { value: "users" },
    });
    fireEvent.change(screen.getByLabelText("Value for id"), {
      target: { value: "42" },
    });
    fireEvent.click(screen.getByLabelText("Insert snippet: byId"));

    expect(onInsert).toHaveBeenCalledWith("SELECT * FROM users WHERE id = 42");
    expect(onClose).toHaveBeenCalled();
  });

  it("leaves an unfilled placeholder intact on insert", () => {
    useSnippetsStore
      .getState()
      .addSnippet("partial", "SELECT {{col}} FROM {{table}}");
    render(
      <SnippetsPanel currentSql="" onInsert={onInsert} onClose={onClose} />,
    );
    fireEvent.click(screen.getByLabelText("Insert snippet: partial"));
    fireEvent.change(screen.getByLabelText("Value for col"), {
      target: { value: "name" },
    });
    fireEvent.click(screen.getByLabelText("Insert snippet: partial"));
    expect(onInsert).toHaveBeenCalledWith("SELECT name FROM {{table}}");
  });

  it("deletes a snippet", () => {
    useSnippetsStore.getState().addSnippet("gone", "SELECT 1");
    render(
      <SnippetsPanel currentSql="" onInsert={onInsert} onClose={onClose} />,
    );
    fireEvent.click(screen.getByLabelText("Delete snippet: gone"));
    expect(useSnippetsStore.getState().snippets).toHaveLength(0);
  });

  it("calls onClose from the close button", () => {
    render(
      <SnippetsPanel currentSql="" onInsert={onInsert} onClose={onClose} />,
    );
    fireEvent.click(screen.getByLabelText("Close snippets"));
    expect(onClose).toHaveBeenCalled();
  });
});
