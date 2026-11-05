import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileText, Home, Images, Send, Smartphone } from "lucide-react";
import { BuildMediaButton } from "@/components/studio/BuildMediaButton";
import { StudioActivity } from "@/components/studio/StudioActivity";
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
 * place. At the far right, in a studio: "Build media" on a showcase cut
 * from a recording (BuildMediaButton), one slot for what the studio is
 * doing — a running export or build, with its cancel (StudioActivity) —
 * then the gear button, which opens the studio-wide settings
 * (StudioSettings) and carries a dot while the subscription needs the
 * user. Status that needs nothing from the user stays out of the bar.
 *
 * The bar is a container, and its parts collapse by the room the bar
 * has, not the window's width: beside the studio agent's dock
 * (640 px, __root.tsx) the bar is half the window, and a viewport
 * breakpoint would still call it wide. From 56rem of bar (@4xl) the
 * tabs show their labels and Build media its words; below that they
 * keep their icons, and the activity pill drops its bar and its name
 * (the tooltip has them). The title truncates, but never to nothing.
 * Clicks don't bubble (the player listens for clicks on its stage). The
 * Share tab shows only in a studio: sharing works on the studio's
 * exports. */
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
      className="@container sticky top-0 z-40 flex h-14 w-full shrink-0 items-center gap-3 border-b border-border bg-background/60 px-4 backdrop-blur-md @4xl:px-6"
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
      <p className="min-w-24 truncate font-display text-lg tracking-tight text-foreground">
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
                "inline-flex items-center gap-2 border-b-2 px-3 text-sm transition-colors @4xl:px-4",
                key === current
                  ? "border-primary text-foreground"
                  : "border-transparent text-foreground/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              <span className="hidden @4xl:inline">{label}</span>
            </Link>
          ),
        )}
      </nav>
      {built && <BuildMediaButton showcaseId={showcaseId} />}
      <StudioActivity showcaseId={showcaseId} />
      <StudioSettings />
    </header>
  );
}
