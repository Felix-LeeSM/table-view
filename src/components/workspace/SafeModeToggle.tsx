import { ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";
import { Button } from "@components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@components/ui/hover-card";
import { useSafeModeStore, type SafeMode } from "@stores/safeModeStore";

/**
 * Sprint 185 — Safe Mode toggle.
 * Sprint 186 — extended to a 3-way cycle (strict → warn → off → strict).
 *
 * Workspace-toolbar control that flips `useSafeModeStore.mode`. The strict
 * → warn step prevents a single click from silently disabling the production
 * guard; warn opens a type-to-confirm dialog at commit time instead of
 * blocking outright (see `ConfirmDangerousDialog`).
 *
 * Post-Sprint-187 hotfix — visuals: drop the hard-coded hex border in
 * favour of icon-shape-only differentiation (ShieldCheck / ShieldAlert /
 * ShieldOff already carry distinct silhouettes). The verbose mode-by-mode
 * description that users asked for is wired through a HoverCard wrapping
 * the toggle itself, so a deliberate hover (150ms openDelay) reveals the
 * detail without needing a sibling Info button. Click still toggles the
 * mode — Radix's HoverCardTrigger forwards onClick to the underlying
 * Button.
 */
const MODE_META: Record<
  SafeMode,
  {
    label: string;
    tooltip: string;
    ariaPressed: "true" | "mixed" | "false";
    icon: typeof ShieldCheck;
  }
> = {
  strict: {
    label: "Safe Mode",
    tooltip:
      "Safe Mode is on (strict — production blocks dangerous SQL; click to switch to warn)",
    ariaPressed: "true",
    icon: ShieldCheck,
  },
  warn: {
    label: "Safe Mode: Warn",
    tooltip:
      "Safe Mode is in warn mode (production prompts before dangerous SQL; click to disable)",
    ariaPressed: "mixed",
    icon: ShieldAlert,
  },
  off: {
    label: "Safe Mode: Off",
    tooltip: "Safe Mode is off (click to re-enable production guard)",
    ariaPressed: "false",
    icon: ShieldOff,
  },
};

export default function SafeModeToggle() {
  const mode = useSafeModeStore((s) => s.mode);
  const toggle = useSafeModeStore((s) => s.toggle);
  const meta = MODE_META[mode];
  const Icon = meta.icon;

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          aria-label={meta.label}
          aria-pressed={meta.ariaPressed}
          title={meta.tooltip}
          data-mode={mode}
          onClick={toggle}
        >
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="ml-1 text-xs">{meta.label}</span>
        </Button>
      </HoverCardTrigger>
      <HoverCardContent
        align="end"
        side="bottom"
        className="w-96 text-xs leading-relaxed"
        data-testid="safe-mode-help"
      >
        <p className="mb-2 font-semibold text-foreground">About Safe Mode</p>
        <p className="mb-2 text-muted-foreground">
          Safe Mode is Table View&apos;s guard against accidental data loss on
          connections tagged <span className="font-mono">production</span>.
        </p>
        <dl className="space-y-2">
          <div>
            <dt className="font-semibold text-foreground">Strict</dt>
            <dd className="ml-2 text-muted-foreground">
              Blocks Execute on:
              <ul className="ml-4 list-disc">
                <li>
                  <code>DROP TABLE / DATABASE / SCHEMA / INDEX / VIEW</code>
                </li>
                <li>
                  <code>TRUNCATE TABLE</code>
                </li>
                <li>
                  <code>ALTER TABLE … DROP COLUMN / DROP CONSTRAINT</code>
                </li>
                <li>
                  <code>UPDATE / DELETE</code> without <code>WHERE</code>
                </li>
              </ul>
              You see an inline error explaining what was blocked.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">Warn</dt>
            <dd className="ml-2 text-muted-foreground">
              Same statements, but instead of blocking the user is asked to type
              the operation name (e.g. <code>DROP TABLE</code>) to confirm
              before commit.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">Off</dt>
            <dd className="ml-2 text-muted-foreground">
              No guard. Use only for one-off destructive maintenance.
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-muted-foreground">
          Non-production environments (local / testing / development / staging)
          are never gated.
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
