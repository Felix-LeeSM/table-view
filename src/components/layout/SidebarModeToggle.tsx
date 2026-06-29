import { useTranslation } from "react-i18next";
import { Database, ListTree } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";

export type SidebarMode = "connections" | "schemas";

interface SidebarModeToggleProps {
  mode: SidebarMode;
  onChange: (mode: SidebarMode) => void;
}

const OPTIONS = [
  {
    key: "connections" as SidebarMode,
    labelKey: "sidebarModeToggle.connections" as const,
    icon: Database,
  },
  {
    key: "schemas" as SidebarMode,
    labelKey: "sidebarModeToggle.schemas" as const,
    icon: ListTree,
  },
] as const;

export default function SidebarModeToggle({
  mode,
  onChange,
}: SidebarModeToggleProps) {
  const { t } = useTranslation("layout");
  return (
    <ToggleGroup
      type="single"
      value={mode}
      onValueChange={(v) => v && onChange(v as SidebarMode)}
      aria-label={t("sidebarModeToggle.sidebarModeAria")}
      className="bg-background"
    >
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const label = t(opt.labelKey);
        return (
          <ToggleGroupItem
            key={opt.key}
            value={opt.key}
            aria-label={t("sidebarModeToggle.modeAria", { label })}
            className="flex-1 gap-1.5 data-[state=on]:bg-secondary"
          >
            <Icon size={12} />
            {label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
