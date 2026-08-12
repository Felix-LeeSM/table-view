import { Button } from "@components/ui/button";
import ConfirmDialog from "@components/ui/dialog/ConfirmDialog";
import {
  ERD_RELATIONSHIP_ENCODINGS,
  type ErdRelationshipKind,
} from "@lib/schemaGraphVirtualFk";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * ERD relationship legend (#2150, absorbed from #1663).
 *
 * The legend is what makes the diagram readable without colour vision: each
 * entry draws the same line pattern and arrow head the canvas draws, so the
 * difference between a real FK and a hand-drawn virtual FK is carried by shape
 * as well as by tint (ADR 0055 "색 단독 인코딩 금지"). Colours are not part of
 * `ERD_RELATIONSHIP_ENCODINGS` at all — `currentColor` here, canvas palette
 * there.
 *
 * It also hosts the reset affordance for the persisted virtual FKs. The rule is
 * `memory/product/memory.md` 「위치 룰」, whose per-entity row reads "그 entity 의
 * 헤더 우클릭 메뉴" — this is that entity's header, but the control is a plain
 * button, not a right-click menu: the ERD header strip carries no context menu,
 * and stored links the current schema cannot draw are invisible, so the way out
 * of them has to be visible too.
 */
export interface SchemaErdLegendProps {
  /** Relationship kinds currently on the canvas. */
  readonly kinds: readonly ErdRelationshipKind[];
  /** Omitted when this ERD has no stored virtual FKs to reset. */
  readonly onResetVirtualFks?: () => void;
}

export default function SchemaErdLegend({
  kinds,
  onResetVirtualFks,
}: SchemaErdLegendProps) {
  const { t } = useTranslation("schema");
  const [confirming, setConfirming] = useState(false);
  // The reset control keeps the strip alive even with nothing to caption: a
  // schema change can leave stored links that draw nothing, and hiding the
  // control then would strand persisted state with no way to clear it. One
  // stranding is left over: a stored row this build cannot parse hydrates to no
  // links, so `SchemaErdPanel` never passes the prop and the strip never gets
  // the chance (`src/lib/schemaGraphVirtualFk.ts` drops what it cannot read).
  if (kinds.length === 0 && !onResetVirtualFks) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/20 px-3 py-1">
      {kinds.length > 0 && (
        <ul
          aria-label={t("erdLegendAria")}
          className="flex flex-wrap items-center gap-3 text-3xs text-muted-foreground"
        >
          {kinds.map((kind) => (
            <li
              key={kind}
              data-relationship-kind={kind}
              className="flex items-center gap-1.5"
            >
              <RelationshipSwatch kind={kind} />
              <span>{t(ERD_RELATIONSHIP_ENCODINGS[kind].legendKey)}</span>
            </li>
          ))}
        </ul>
      )}
      {onResetVirtualFks && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto text-3xs"
            // No `aria-label`: an accessible name that does not contain the
            // visible one breaks speech input (WCAG 2.5.3 Label in Name). The
            // longer wording rides `title`, which names nothing and describes.
            title={t("resetVirtualFksTitle")}
            onClick={() => setConfirming(true)}
          >
            <RotateCcw size={12} aria-hidden="true" />
            {t("resetVirtualFks")}
          </Button>
          {confirming && (
            <ConfirmDialog
              title={t("resetVirtualFksTitle")}
              message={t("resetVirtualFksMessage")}
              confirmLabel={t("resetVirtualFksConfirm")}
              danger
              onConfirm={() => {
                setConfirming(false);
                onResetVirtualFks();
              }}
              onCancel={() => setConfirming(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Line preview. `strokeDasharray` and the arrow head come straight from the
 * encoding table, so a legend entry can never drift from the drawn edge.
 */
function RelationshipSwatch({ kind }: { kind: ErdRelationshipKind }) {
  const encoding = ERD_RELATIONSHIP_ENCODINGS[kind];
  return (
    <svg
      width="28"
      height="8"
      viewBox="0 0 28 8"
      aria-hidden="true"
      focusable="false"
      className="shrink-0 text-foreground"
    >
      <line
        x1="0"
        y1="4"
        x2="20"
        y2="4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={encoding.strokeDasharray ?? undefined}
      />
      {encoding.marker === "arrowclosed" ? (
        <polygon points="20,0.5 28,4 20,7.5" fill="currentColor" />
      ) : (
        <polyline
          points="21,0.5 28,4 21,7.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      )}
    </svg>
  );
}
