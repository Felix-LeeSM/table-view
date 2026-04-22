import { Database, ListTree } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";

export type SidebarMode = "connections" | "schemas";

interface SidebarModeToggleProps {
  mode: SidebarMode;
  onChange: (mode: SidebarMode) => void;
}

const OPTIONS = [
  { key: "connections" as SidebarMode, label: "Connections", icon: Database },
  { key: "schemas" as SidebarMode, label: "Schemas", icon: ListTree },
] as const;

export default function SidebarModeToggle({
  mode,
  onChange,
}: SidebarModeToggleProps) {
  return (
    <ToggleGroup
      type="single"
      value={mode}
      onValueChange={(v) => v && onChange(v as SidebarMode)}
      aria-label="Sidebar mode"
      className="bg-background"
    >
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        return (
          <ToggleGroupItem
            key={opt.key}
            value={opt.key}
            aria-label={`${opt.label} mode`}
            className="flex-1 gap-1.5 data-[state=on]:bg-secondary"
          >
            <Icon size={12} />
            {opt.label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
