import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, FolderOpen, FolderSearch, Home, Menu } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { studio } from "@/lib/studio";

/* The app menu, pinned to the same top-left corner on every screen:
 * Home, plus the showcases-folder actions when running in the studio
 * (they mirror the system File menu). An optional back link to the
 * previous screen sits beside it. Clicks don't bubble (the player
 * toggles pause on background clicks). */
export function HomeBackNav({
  showcaseId,
  backLabel,
}: {
  showcaseId?: string;
  backLabel?: string;
}) {
  const navigate = useNavigate();
  const [inStudio, setInStudio] = useState(false);
  useEffect(() => setInStudio(Boolean(studio()?.folder)), []);

  return (
    <div
      className="fixed left-4 top-4 z-40 flex items-center gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="App menu"
          className="inline-flex rounded-full border border-border bg-card/60 p-2.5 text-foreground/70 backdrop-blur-sm transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Menu className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuItem onSelect={() => void navigate({ to: "/" })}>
            <Home className="mr-2 size-4" /> All showcases
          </DropdownMenuItem>
          {inStudio && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void studio()?.folder.choose()}>
                <FolderOpen className="mr-2 size-4" /> Choose Showcases Folder…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void studio()?.folder.reveal()}>
                <FolderSearch className="mr-2 size-4" /> Reveal Folder in Finder
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {showcaseId && backLabel && (
        <Link
          to="/showcase/$showcaseId"
          params={{ showcaseId }}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-2 text-sm text-foreground/70 backdrop-blur-sm transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {backLabel}
        </Link>
      )}
    </div>
  );
}
