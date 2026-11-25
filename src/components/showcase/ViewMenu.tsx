/* The player's View menu: how you're watching, never what you're making.
 *
 *   View ▾
 *   ┌──────────────────────────────┐
 *   │ Show as                      │
 *   │ ● TikTok                     │
 *   │ ○ App Screens                │
 *   │ ○ 4:3                        │
 *   │ ☐ Open in this view          │  (in a studio: meta.view)
 *   │ ─────────────────────────────│
 *   │ ☐ TikTok safe area           │  (TikTok view only)
 *   └──────────────────────────────┘
 *
 * Something that changes the video goes in the Edit scene panel
 * (EditScenePanel), and something that makes a file goes in the Export
 * menu (ExportButton). "Open in this view" is the one item here that
 * writes showcase.yaml: it only decides how the showcase opens. */
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { playerView, VIEW_LABELS, type PlayerView } from "@/lib/export-kinds.mjs";
import { barButtonClass } from "./bar-button";

const VIEWS = [
  ["tiktok", "TikTok"],
  ["screens", "App Screens"],
  ["embed", "4:3"],
] as const;

export function ViewMenu({
  view,
  onView,
  pinned,
  onPin,
  safeArea,
  onToggleSafeArea,
}: {
  view: PlayerView;
  onView: (view: PlayerView) => void;
  /** This view is the one the showcase opens in (meta.view). */
  pinned: boolean;
  /** Sets or clears meta.view; absent where no studio can write it. */
  onPin?: (() => void) | undefined;
  safeArea: boolean;
  onToggleSafeArea: () => void;
}) {
  /* Keys pressed in the menu (Space, arrows) must not reach the player's
   * shortcuts on window. */
  const keepKeys = (e: React.KeyboardEvent) => e.stopPropagation();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" title="How you're watching" className={barButtonClass}>
          {VIEW_LABELS[view]} <ChevronDown className="size-3.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60" onKeyDown={keepKeys}>
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Show as
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={view}
          onValueChange={(value) => {
            const next = playerView(value);
            if (next) onView(next);
          }}
        >
          {VIEWS.map(([key, label]) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {onPin && (
          <DropdownMenuCheckboxItem
            checked={pinned}
            onCheckedChange={onPin}
            title={
              pinned
                ? `This showcase opens in the ${VIEW_LABELS[view]} view (saved in showcase.yaml). Uncheck to go back to the default, TikTok.`
                : `Open this showcase in the ${VIEW_LABELS[view]} view from now on (saved in showcase.yaml)`
            }
          >
            Open in this view
          </DropdownMenuCheckboxItem>
        )}
        {view === "tiktok" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={safeArea}
              onCheckedChange={onToggleSafeArea}
              title="Shade where TikTok's tabs, buttons and description will cover the video"
            >
              TikTok safe area
            </DropdownMenuCheckboxItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
