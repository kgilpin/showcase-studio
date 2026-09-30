import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileText, Home, Images, Send, Smartphone } from "lucide-react";
import { BuildMediaButton } from "@/components/studio/BuildMediaButton";
import { ExportStatus } from "@/components/studio/ExportStatus";
import { StudioSettings } from "@/components/studio/StudioSettings";
import { studio, useWindowLock } from "@/lib/studio";
import { cn } from "@/lib/utils";

/* The showcase's tab bar, across the top of the player, Script, Assets
 * and Share screens: Home, the showcase's title, and its sibling views as
 * tabs. It takes its own row in the page (sticky on pages that scroll),
 * so content starts below it instead of under floating buttons. A locked
 * window (--open / --new) has no Home. Player transport and view settings
 * stay in the player's own bottom bar; going somewhere else lives up
 * here. Tab icons are nouns (what the screen shows) — the play triangle
 * is reserved for actions that start playback, so it never labels a
 * place. On narrow screens the tabs drop their labels and keep the
 * icons. At the far right, in a studio: "Build media" on a showcase cut
 * from a recording (BuildMediaButton), a running export's progress
 * (ExportStatus), then the gear button, which opens the
 * studio-wide settings (StudioSettings). Clicks don't bubble (the player listens for clicks on its
 * stage). The Share tab shows only in a studio: sharing works on the
 * studio's exports. */
const TABS = [
  { key: "player", label: "Showcase", to: "/showcase/$showcaseId", icon: Smartphone },
  { key: "script", label: "Script", to: "/showcase/$showcaseId/script", icon: FileText },
  { key: "assets", label: "Assets", to: "/showcase/$showcaseId/assets", icon: Images },
  { key: "share", label: "Share", to: "/showcase/$showcaseId/share", icon: Send, studioOnly: true },
] as const;

export function ShowcaseNav({
  showcaseId,
  title,
  current,
  built = false,
}: {
  showcaseId: string;
  title: string;
  current: (typeof TABS)[number]["key"];
  /** The showcase is cut from a recording (meta.source) — it gets the
   *  "Build media" button. */
  built?: boolean;
}) {
  const locked = useWindowLock() != null;
  const [inStudio, setInStudio] = useState(false);
  useEffect(() => setInStudio(studio() != null), []);
  return (
    <header
      className="sticky top-0 z-40 flex h-14 w-full shrink-0 items-center gap-3 border-b border-border bg-background/60 px-4 backdrop-blur-md sm:px-6"
      onClick={(e) => e.stopPropagation()}
    >
      {!locked && (
        <Link
          to="/"
          aria-label="All showcases"
          title="All showcases"
          className="-ml-2 inline-flex shrink-0 rounded-full p-2 text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Home className="size-4" />
        </Link>
      )}
      <p className="min-w-0 truncate font-display text-lg tracking-tight text-foreground">
        {title}
      </p>
      <nav
        aria-label="Showcase views"
        className="-mb-px ml-auto flex h-full shrink-0 items-stretch"
      >
        {TABS.filter((tab) => !("studioOnly" in tab) || inStudio).map(
          ({ key, label, to, icon: Icon }) => (
            <Link
              key={key}
              to={to}
              params={{ showcaseId }}
              aria-label={label}
              aria-current={key === current ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-2 border-b-2 px-3 text-sm transition-colors sm:px-4",
                key === current
                  ? "border-primary text-foreground"
                  : "border-transparent text-foreground/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ),
        )}
      </nav>
      {built && <BuildMediaButton showcaseId={showcaseId} />}
      <ExportStatus showcaseId={showcaseId} />
      <StudioSettings />
    </header>
  );
}
