import { Database, ListTree } from "lucide-react";

export type SidebarMode = "connections" | "schemas";

interface SidebarModeToggleProps {
  mode: SidebarMode;
  onChange: (mode: SidebarMode) => void;
}

interface ModeOption {
  key: SidebarMode;
  label: string;
  icon: typeof Database;
}

const OPTIONS: ModeOption[] = [
  { key: "connections", label: "Connections", icon: Database },
  { key: "schemas", label: "Schemas", icon: ListTree },
];

export default function SidebarModeToggle({
  mode,
  onChange,
}: SidebarModeToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Sidebar mode"
      className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5"
    >
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = mode === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`${opt.label} mode`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-secondary text-foreground shadow-sm"
                : "text-muted-foreground hover:text-secondary-foreground"
            }`}
          >
            <Icon size={12} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
