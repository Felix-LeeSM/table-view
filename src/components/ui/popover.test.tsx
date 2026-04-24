import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

describe("Popover", () => {
  it("mounts content only after the trigger is clicked", () => {
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>
          <div data-testid="popover-body">hello</div>
        </PopoverContent>
      </Popover>,
    );

    // Portal content is absent until the user opens the popover.
    expect(screen.queryByTestId("popover-body")).toBeNull();

    act(() => {
      fireEvent.click(screen.getByText("Open"));
    });

    expect(screen.getByTestId("popover-body")).toBeInTheDocument();
  });

  it("closes when Escape is pressed", () => {
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>
          <div data-testid="popover-body">hello</div>
        </PopoverContent>
      </Popover>,
    );

    act(() => {
      fireEvent.click(screen.getByText("Open"));
    });
    expect(screen.getByTestId("popover-body")).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
      });
    });

    expect(screen.queryByTestId("popover-body")).toBeNull();
  });

  it("forwards align / sideOffset props and styles content with the expected tokens", () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent align="start" sideOffset={12}>
          <div data-testid="popover-body">hello</div>
        </PopoverContent>
      </Popover>,
    );

    const content = screen
      .getByTestId("popover-body")
      .closest('[data-slot="popover-content"]');
    expect(content).not.toBeNull();
    expect(content).toHaveClass("bg-popover");
    expect(content).toHaveClass("text-popover-foreground");
    expect(content).toHaveClass("border-border");
  });
});
