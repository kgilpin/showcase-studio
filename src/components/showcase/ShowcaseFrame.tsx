import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { FileText, Film, Home, Image as ImageIcon, Images, Send } from "lucide-react";
import { StudioActivity } from "@/components/studio/StudioActivity";
import { StudioSettings } from "@/components/studio/StudioSettings";
import { studio, useWindowLock } from "@/lib/studio";
import { cn } from "@/lib/utils";

/* The frame around a showcase's screens — the player (Video), Cover,
 * Script, Assets and Share:
 *
 *   ┌──────┬──────────────────────────────┐
 *   │  ⌂   │ title             activity  ⚙│  top bar
 *   ├──────┼──────────────────────────────┤
 *   │Video │                              │
 *   │Cover │                              │
 *   │Script│          the page            │
 *   │Assets│                              │
 *   │ ──── │                              │
 *   │Share │                              │
 *   └──────┴──────────────────────────────┘
 *
 * The rail down the left lists the showcase's places, each an icon with
 * its label under it, at any width the studio runs at. PLACES is the
 * list: a place is one line there, and a change of `group` draws a
 * divider (the things you make, then sending them out). Icons are nouns
 * (what the screen shows) — the play triangle is reserved for actions
 * that start playback, so it never labels a place. Share shows only in
 * a studio: sharing works on the studio's exports. A new screen gets
 * its place by adding its line to PLACES. The capture pages (/export,
 * /record) don't use the frame.
 *
 * The top bar holds Home (none in a locked window, --open / --new), the
 * showcase's title, and at the right, in a studio: one slot for what
 * the studio is doing — a running export or build (the studio builds a
 * recorded or voiced showcase's media on its own when its inputs
 * change, issue #37), a commit about to happen with its skip, a failure
 * not yet dismissed — which opens the Actions list, every export, build
 * and commit and what can be done about each (StudioActivity); then the
 * gear button, which opens the studio-wide settings (StudioSettings)
 * and carries a dot while the subscription needs the user. Status that
 * needs nothing from the user stays out of the bar. Player transport and
 * view settings stay in the player's own bottom bar.
 *
 * The frame is a container, and it lays out by the room it has, not the
 * window's width: beside the studio agent's dock (640 px, __root.tsx)
 * the frame is half the window, and a viewport breakpoint would still
 * call it wide. Below 42rem of frame (@2xl, a phone) the rail turns into
 * a bar along the bottom, same places, same labels. Below 56rem the
 * activity pill drops its bar and its name (the tooltip has them). The
 * title truncates, but never to nothing. Clicks don't bubble (the player
 * listens for clicks on its stage).
 *
 * `fill` is for a page that fills the window and never scrolls (the
 * player): the frame is the window's height and the page gets the rest
 * of it. Otherwise the page scrolls and the top bar and rail stay put. */
const PLACES = [
  { key: "player", label: "Video", to: "/showcase/$showcaseId", icon: Film, group: "make" },
  {
    key: "cover",
    label: "Cover",
    to: "/showcase/$showcaseId/cover",
    icon: ImageIcon,
    group: "make",
  },
  {
    key: "script",
    label: "Script",
    to: "/showcase/$showcaseId/script",
    icon: FileText,
    group: "make",
  },
  {
    key: "assets",
    label: "Assets",
    to: "/showcase/$showcaseId/assets",
    icon: Images,
    group: "make",
  },
  {
    key: "share",
    label: "Share",
    to: "/showcase/$showcaseId/share",
    icon: Send,
    group: "send",
    studioOnly: true,
  },
] as const;

export type ShowcasePlace = (typeof PLACES)[number]["key"];

export function ShowcaseFrame({
  showcaseId,
  title,
  current,
  fill = false,
  className,
  children,
}: {
  showcaseId: string;
  title: string;
  current: ShowcasePlace;
  fill?: boolean;
  /* The page's own classes, for the <main> the frame puts it in. */
  className?: string;
  children: ReactNode;
}) {
  const locked = useWindowLock() != null;
  const [inStudio, setInStudio] = useState(false);
  useEffect(() => setInStudio(studio() != null), []);
  const places = PLACES.filter((place) => !("studioOnly" in place) || inStudio);
  return (
    <div
      className={cn(
        "@container/frame flex w-full flex-col",
        fill ? "h-dvh overflow-hidden" : "min-h-dvh",
      )}
      style={{ background: "var(--gradient-stage)" }}
    >
      <header
        className="sticky top-0 z-40 flex h-14 w-full shrink-0 items-center gap-3 border-b border-border bg-background/60 pr-4 backdrop-blur-md @2xl/frame:pr-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Home sits over the rail, so the rail reads as one column. */}
        <div className="flex h-full shrink-0 items-center justify-center pl-2 @2xl/frame:w-[72px] @2xl/frame:border-r @2xl/frame:border-border @2xl/frame:pl-0">
          {!locked && (
            <Link
              to="/"
              aria-label="All showcases"
              title="All showcases"
              className="inline-flex rounded-full p-2 text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Home className="size-4" />
            </Link>
          )}
        </div>
        <p className="min-w-24 truncate font-display text-lg tracking-tight text-foreground">
          {title}
        </p>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <StudioActivity showcaseId={showcaseId} />
          <StudioSettings />
        </div>
      </header>
      <div className={cn("flex w-full flex-1 flex-col @2xl/frame:flex-row", fill && "min-h-0")}>
        <nav
          aria-label="Showcase places"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            /* A phone: a bar along the bottom (last in the column). */
            "sticky bottom-0 z-40 order-last flex h-16 w-full shrink-0 items-stretch justify-around border-t border-border bg-background/80 px-2 backdrop-blur-md",
            /* Wider: the rail down the left, kept in view as the page scrolls. */
            "@2xl/frame:order-first @2xl/frame:h-auto @2xl/frame:w-[72px] @2xl/frame:flex-col @2xl/frame:items-center @2xl/frame:justify-start @2xl/frame:gap-1 @2xl/frame:overflow-y-auto @2xl/frame:border-r @2xl/frame:border-t-0 @2xl/frame:bg-background/40 @2xl/frame:px-0 @2xl/frame:py-3",
            fill
              ? "@2xl/frame:static"
              : "@2xl/frame:top-14 @2xl/frame:h-[calc(100dvh-3.5rem)] @2xl/frame:self-start",
          )}
        >
          {places.map(({ key, label, to, icon: Icon, group }, i) => (
            <div key={key} className="contents">
              {i > 0 && group !== places[i - 1]?.group && (
                <div
                  aria-hidden
                  className="my-3 w-px shrink-0 bg-border @2xl/frame:mx-auto @2xl/frame:my-2 @2xl/frame:h-px @2xl/frame:w-8"
                />
              )}
              <Link
                to={to}
                params={{ showcaseId }}
                aria-current={key === current ? "page" : undefined}
                className={cn(
                  "my-1.5 flex min-w-14 flex-col items-center justify-center gap-1 rounded-lg px-1.5 text-[0.7rem] leading-none transition-colors",
                  "@2xl/frame:my-0 @2xl/frame:h-14 @2xl/frame:w-14 @2xl/frame:shrink-0",
                  key === current
                    ? "bg-primary/15 font-medium text-foreground"
                    : "text-foreground/60 hover:bg-secondary hover:text-foreground",
                )}
              >
                <Icon className={cn("size-5", key === current && "text-primary")} />
                <span>{label}</span>
              </Link>
            </div>
          ))}
        </nav>
        <main className={cn("min-w-0 flex-1", fill && "min-h-0", className)}>{children}</main>
      </div>
    </div>
  );
}
