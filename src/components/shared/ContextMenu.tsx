import { useEffect, useRef, useState, useCallback } from "react";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [measured, setMeasured] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const focusItem = useCallback((index: number) => {
    if (!ref.current) return;
    const buttons = ref.current.querySelectorAll('[role="menuitem"]');
    (buttons[index] as HTMLElement)?.focus();
  }, []);

  // Focus the first item when menu opens
  useEffect(() => {
    if (measured && items.length > 0) {
      // Find first non-disabled item
      const firstEnabled = items.findIndex((item) => !item.disabled);
      const index = firstEnabled >= 0 ? firstEnabled : 0;
      setActiveIndex(index);
      focusItem(index);
    }
  }, [measured, items, focusItem]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => {
          let next = prev;
          do {
            next = (next + 1) % items.length;
          } while (items[next]?.disabled && next !== prev);
          focusItem(next);
          return next;
        });
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => {
          let next = prev;
          do {
            next = (next - 1 + items.length) % items.length;
          } while (items[next]?.disabled && next !== prev);
          focusItem(next);
          return next;
        });
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, items, focusItem]);

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    let left = x;
    let top = y;

    if (left + rect.width > window.innerWidth) {
      left = Math.max(0, window.innerWidth - rect.width - 4);
    }
    if (top + rect.height > window.innerHeight) {
      top = Math.max(0, window.innerHeight - rect.height - 4);
    }

    setPosition({ left, top });
    setMeasured(true);
  }, [x, y]);

  const style: React.CSSProperties = {
    position: "fixed",
    left: position.left,
    top: position.top,
    zIndex: 100,
  };

  return (
    <div
      ref={ref}
      style={style}
      role="menu"
      aria-label="Context menu"
      className={measured ? "select-none" : "select-none invisible"}
    >
      <div className="min-w-[160px] rounded-md border border-border bg-secondary py-1 shadow-lg">
        {items.map((item, index) =>
          item.separator ? (
            <div
              key={`sep-${index}`}
              role="separator"
              className="my-1 border-t border-border"
            />
          ) : (
            <button
              key={item.label}
              role="menuitem"
              tabIndex={index === activeIndex ? 0 : -1}
              aria-disabled={item.disabled}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm outline-none ${
                item.disabled
                  ? "cursor-not-allowed opacity-40"
                  : index === activeIndex
                    ? "bg-muted focus:bg-muted"
                    : "hover:bg-muted focus:bg-muted"
              } ${item.danger ? "text-destructive" : "text-foreground"}`}
              onClick={() => {
                if (item.disabled) return;
                item.onClick();
                onClose();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
