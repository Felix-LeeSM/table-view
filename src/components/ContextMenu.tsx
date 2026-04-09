import { useEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
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

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

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
      className={measured ? "" : "invisible"}
    >
      <div className="min-w-[160px] rounded-md border border-(--color-border) bg-(--color-bg-secondary) py-1 shadow-lg">
        {items.map((item) => (
          <button
            key={item.label}
            role="menuitem"
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-(--color-bg-tertiary) ${
              item.danger
                ? "text-(--color-danger)"
                : "text-(--color-text-primary)"
            }`}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
