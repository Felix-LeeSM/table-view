/**
 * Issue #1231 — raw-query row cap control.
 *
 * A no-LIMIT JOIN can materialise millions of rows; the backend caps the
 * fetch at `query_row_cap` (default 10,000) and flags `truncated`. This
 * popover lets the user raise/lower that cap and reset it to the default.
 *
 * Self-contained (no store): the backend reads `query_row_cap` fresh from
 * SQLite on every query, so this control only needs to (a) hydrate the
 * current value on open and (b) persist edits. Cross-window live-sync is not
 * wired — a rarely-changed numeric that the backend re-reads per query does
 * not need it. ponytail: add a store + settingsReceiver route if that changes.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Rows3 } from "lucide-react";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import { logger } from "@lib/logger";
import {
  getSetting,
  persistSettingValue,
  resetSetting,
} from "@lib/tauri/settings";

// Keep in sync with `src-tauri/src/db/row_cap.rs`.
const DEFAULT_ROW_CAP = 10_000;
const MIN_ROW_CAP = 100;
const MAX_ROW_CAP = 1_000_000;
const SETTING_KEY = "query_row_cap";

function clamp(n: number): number {
  return Math.min(MAX_ROW_CAP, Math.max(MIN_ROW_CAP, Math.round(n)));
}

export default function RowCapSetting() {
  const { t } = useTranslation("settings");
  const [cap, setCap] = useState<number>(DEFAULT_ROW_CAP);
  // Raw input string so the user can clear/retype without an eager clamp.
  const [draft, setDraft] = useState<string>(String(DEFAULT_ROW_CAP));

  useEffect(() => {
    void (async () => {
      try {
        const raw = await getSetting(SETTING_KEY);
        if (raw === null) return;
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === "number" && Number.isFinite(parsed)) {
          const next = clamp(parsed);
          setCap(next);
          setDraft(String(next));
        }
      } catch {
        // Unreadable / malformed — keep the default; the backend also
        // falls back to the default so enforcement stays correct.
      }
    })();
  }, []);

  const commit = (): void => {
    const parsed = Number(draft);
    const next =
      Number.isFinite(parsed) && draft.trim() !== "" ? clamp(parsed) : cap;
    setCap(next);
    setDraft(String(next));
    void persistSettingValue(SETTING_KEY, next).catch((e: unknown) => {
      logger.warn(
        `[RowCapSetting] persist ${SETTING_KEY} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    });
  };

  const reset = (): void => {
    setCap(DEFAULT_ROW_CAP);
    setDraft(String(DEFAULT_ROW_CAP));
    void resetSetting(SETTING_KEY).catch((e: unknown) => {
      logger.warn(
        `[RowCapSetting] reset ${SETTING_KEY} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          data-testid="row-cap-setting-trigger"
          aria-label={t("rowCap.ariaLabel")}
          title={t("rowCap.tooltip", { count: cap.toLocaleString() })}
        >
          <Rows3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="ml-1 text-xs">{cap.toLocaleString()}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-2">
          <label
            htmlFor="row-cap-input"
            className="text-xs font-medium text-foreground"
          >
            {t("rowCap.label")}
          </label>
          <p className="text-xs text-muted-foreground">{t("rowCap.help")}</p>
          <div className="flex items-center gap-2">
            <Input
              id="row-cap-input"
              type="number"
              min={MIN_ROW_CAP}
              max={MAX_ROW_CAP}
              step={100}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
              }}
              className="h-8"
              data-testid="row-cap-input"
            />
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={reset}
              data-testid="row-cap-reset"
            >
              {t("rowCap.reset")}
            </Button>
          </div>
          <p className="text-3xs text-muted-foreground">
            {t("rowCap.range", {
              min: MIN_ROW_CAP.toLocaleString(),
              max: MAX_ROW_CAP.toLocaleString(),
            })}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
