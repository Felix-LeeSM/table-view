import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FavoritesPanel from "./FavoritesPanel";
import { useFavoritesStore } from "@stores/favoritesStore";

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  Star: () => <span data-testid="icon-star" />,
  Trash2: () => <span data-testid="icon-trash" />,
  Globe: () => <span data-testid="icon-globe" />,
  Link: () => <span data-testid="icon-link" />,
  X: () => <span data-testid="icon-x" />,
}));

describe("FavoritesPanel", () => {
  const mockOnLoadSql = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    useFavoritesStore.setState({ favorites: [] });
    vi.clearAllMocks();
  });

  it("renders header with title", () => {
    render(
      <FavoritesPanel
        connectionId="conn-1"
        onLoadSql={mockOnLoadSql}
        onClose={mockOnClose}
      />,
    );

    expect(screen.getByText("Favorites")).toBeInTheDocument();
  });

  it("renders empty state when no favorites", () => {
    render(
      <FavoritesPanel
        connectionId="conn-1"
        onLoadSql={mockOnLoadSql}
        onClose={mockOnClose}
      />,
    );

    expect(screen.getByText("No favorites yet")).toBeInTheDocument();
  });

  it("renders favorites list", () => {
    useFavoritesStore.getState().addFavorite("Query 1", "SELECT 1", null);
    useFavoritesStore.getState().addFavorite("Query 2", "SELECT 2", "conn-1");

    render(
      <FavoritesPanel
        connectionId="conn-1"
        onLoadSql={mockOnLoadSql}
        onClose={mockOnClose}
      />,
    );

    expect(screen.getByText("Query 1")).toBeInTheDocument();
    expect(screen.getByText("Query 2")).toBeInTheDocument();
  });

  it("shows SQL preview for each favorite", () => {
    useFavoritesStore
      .getState()
      .addFavorite("My Query", "SELECT * FROM users", null);

    render(
      <FavoritesPanel
        connectionId="conn-1"
        onLoadSql={mockOnLoadSql}
        onClose={mockOnClose}
      />,
    );

    expect(screen.getByText("SELECT * FROM users")).toBeInTheDocument();
  });

  it("loads SQL into editor on favorite click", () => {
    useFavoritesStore.getState().addFavorite("My Query", "SELECT 1", null);

    render(
      <FavoritesPanel
        connectionId="conn-1"
        onLoadSql={mockOnLoadSql}
        onClose={mockOnClose}
      />,
    );

    fireEvent.click(screen.getByLabelText("Load favorite: My Query"));
    expect(mockOnLoadSql).toHaveBeenCalledWith("SELECT 1");
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("deletes a favorite on delete button click", () => {
    useFavoritesStore.getState().addFavorite("Q1", "SELECT 1", null);

    render(
      <FavoritesPanel
        connectionId="conn-1"
        onLoadSql={mockOnLoadSql}
        onClose={mockOnClose}
      />,
    );

    fireEvent.click(screen.getByLabelText("Delete favorite: Q1"));

    expect(useFavoritesStore.getState().favorites).toHaveLength(0);
  });

  it("calls onClose when close button is clicked", () => {
    render(
      <FavoritesPanel
        connectionId="conn-1"
        onLoadSql={mockOnLoadSql}
        onClose={mockOnClose}
      />,
    );

    fireEvent.click(screen.getByLabelText("Close favorites"));
    expect(mockOnClose).toHaveBeenCalled();
  });

  // -- Filter tabs --

  describe("filter tabs", () => {
    beforeEach(() => {
      useFavoritesStore.getState().addFavorite("GlobalFav", "SELECT 1", null);
      useFavoritesStore
        .getState()
        .addFavorite("Conn1Fav", "SELECT 2", "conn-1");
      useFavoritesStore
        .getState()
        .addFavorite("Conn2Fav", "SELECT 3", "conn-2");
    });

    it("shows all (connection + global) by default", () => {
      render(
        <FavoritesPanel
          connectionId="conn-1"
          onLoadSql={mockOnLoadSql}
          onClose={mockOnClose}
        />,
      );

      // conn-1 scope shows GlobalFav + Conn1Fav, not Conn2Fav
      expect(
        screen.getByLabelText("Load favorite: GlobalFav"),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText("Load favorite: Conn1Fav"),
      ).toBeInTheDocument();
      expect(
        screen.queryByLabelText("Load favorite: Conn2Fav"),
      ).not.toBeInTheDocument();
    });

    it("filters to global only", () => {
      render(
        <FavoritesPanel
          connectionId="conn-1"
          onLoadSql={mockOnLoadSql}
          onClose={mockOnClose}
        />,
      );

      fireEvent.click(screen.getByLabelText("Filter: Global"));

      expect(
        screen.getByLabelText("Load favorite: GlobalFav"),
      ).toBeInTheDocument();
      expect(
        screen.queryByLabelText("Load favorite: Conn1Fav"),
      ).not.toBeInTheDocument();
    });

    it("filters to connection only", () => {
      render(
        <FavoritesPanel
          connectionId="conn-1"
          onLoadSql={mockOnLoadSql}
          onClose={mockOnClose}
        />,
      );

      fireEvent.click(screen.getByLabelText("Filter: This Connection"));

      expect(
        screen.queryByLabelText("Load favorite: GlobalFav"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByLabelText("Load favorite: Conn1Fav"),
      ).toBeInTheDocument();
    });
  });

  it("shows globe icon for global favorites and link icon for connection-scoped", () => {
    useFavoritesStore.getState().addFavorite("GlobalFav", "SELECT 1", null);
    useFavoritesStore.getState().addFavorite("Conn1Fav", "SELECT 2", "conn-1");

    render(
      <FavoritesPanel
        connectionId="conn-1"
        onLoadSql={mockOnLoadSql}
        onClose={mockOnClose}
      />,
    );

    // Globe icon for global, Link icon for connection-scoped
    expect(screen.getByTestId("icon-globe")).toBeInTheDocument();
    expect(screen.getByTestId("icon-link")).toBeInTheDocument();
  });
});
