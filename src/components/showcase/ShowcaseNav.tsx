import { Link } from "@tanstack/react-router";
import { FileText, Images, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

/* The showcase's sibling views as labeled pills, pinned top-right on all
 * three screens — one navigation habit everywhere. Player transport and
 * view configuration stay in the player's own bottom bar; going
 * somewhere else lives up here. Tab icons are nouns (what the screen
 * shows) — the play triangle is reserved for actions that start
 * playback, so it never labels a place. */
const TABS = [
  { key: "player", label: "Showcase", to: "/showcase/$showcaseId", icon: Smartphone },
  { key: "script", label: "Script", to: "/showcase/$showcaseId/script", icon: FileText },
  { key: "assets", label: "Assets", to: "/showcase/$showcaseId/assets", icon: Images },
] as const;

export function ShowcaseNav({
  showcaseId,
  current,
}: {
  showcaseId: string;
  current: (typeof TABS)[number]["key"];
}) {
  return (
    <nav
      className="fixed right-4 top-4 z-40 flex items-center gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      {TABS.map(({ key, label, to, icon: Icon }) => (
        <Link
          key={key}
          to={to}
          params={{ showcaseId }}
          aria-current={key === current ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm backdrop-blur-sm transition-colors",
            key === current
              ? "border-primary/60 bg-card/80 text-foreground"
              : "border-border bg-card/60 text-foreground/70 hover:bg-secondary hover:text-foreground",
          )}
        >
          <Icon className="size-4" /> {label}
        </Link>
      ))}
    </nav>
  );
}
