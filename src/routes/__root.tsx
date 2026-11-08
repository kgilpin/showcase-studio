import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  redirect,
  useLocation,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useState, type CSSProperties, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { showcasesReady } from "@/content/showcases";
import { dataMode } from "@/content/source";
import { CodeChangedBanner } from "@/components/studio/CodeChangedBanner";
import { StudioToaster } from "@/components/studio/StudioToaster";
import { StudioAgent } from "@/components/studio/StudioAgent";
import { followLiveUpdates } from "@/lib/live-updates";
import { studioReady, useWindowLock, windowLock } from "@/lib/studio";
import { isCapturePage, isPathInLock, lockLandingPath } from "@/lib/window-lock.mjs";

/* "Go home" on the fallback pages. A locked window has no Home, so it
 * goes back to the page it's locked to instead. */
function GoHome({ className }: { className: string }) {
  const lock = useWindowLock();
  return lock ? (
    <a href={lockLandingPath(lock)} className={className}>
      {lock.kind === "new" ? "Back to New showcase" : "Back to the showcase"}
    </a>
  ) : (
    <a href="/" className={className}>
      Go home
    </a>
  );
}

function NotFoundComponent() {
  const locked = useWindowLock() != null;
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          {locked ? (
            <GoHome className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90" />
          ) : (
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Go home
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <p className="mt-4 break-words rounded-md border border-border bg-card px-3 py-2 text-left font-mono text-xs text-muted-foreground">
          {error.message || String(error)}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <GoHome className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent" />
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  /* Every route reads showcase data synchronously (getShowcase etc.), so
   * gate rendering until the active source has loaded. With the default
   * bundled source this resolves immediately; in data mode (HTTP source,
   * client-only) it fetches first, so skip SSR there. Await without
   * returning: showcases hold React components (TSX graphics), which the
   * router could not dehydrate for the client. */
  /* Waits until the page knows its studio (src/lib/studio.ts). A locked
   * studio (--open / --new) never leaves its showcase: any navigation
   * outside the lock lands back on the locked page. The Electron window
   * enforces the same rule as a backstop (electron/main.mjs). */
  beforeLoad: async ({ location }) => {
    await studioReady;
    /* Changes on disk update the page in place (src/lib/live-updates.ts). */
    followLiveUpdates();
    const lock = windowLock();
    if (!lock || isPathInLock(lock, location.pathname)) return;
    /* The studio's page renderer draws any showcase's slides. */
    if (isCapturePage(location.pathname, new URL(location.href, "http://studio").search)) return;
    throw lock.kind === "new"
      ? redirect({ to: "/new", replace: true })
      : redirect({
          to: "/showcase/$showcaseId",
          params: { showcaseId: lock.showcaseId },
          replace: true,
        });
  },
  loader: async () => {
    await showcasesReady;
  },
  ssr: !dataMode,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "App Showcase" },
      { name: "description", content: "Auto-playing, video-style product tours of apps." },
      { property: "og:title", content: "App Showcase" },
      {
        property: "og:description",
        content: "Auto-playing, video-style product tours of apps.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Work+Sans:wght@300;400;500&display=swap",
      },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  /* When the studio agent docks (integrated terminal), the app content
   * pads over to the left — VS Code style — instead of being overlapped.
   * A fixed overlay (the script player) is positioned by the window, not
   * by this padding, so the width is also set as --studio-dock for it to
   * stop short of the panel. */
  const [dockWidth, setDockWidth] = useState(0);
  const location = useLocation();
  /* A page drawn for a screenshot or video must not show notices. */
  const capturing = isCapturePage(location.pathname, location.searchStr);

  return (
    <QueryClientProvider client={queryClient}>
      <div
        className="min-h-dvh transition-[padding-right] duration-200"
        style={{ paddingRight: dockWidth, "--studio-dock": `${dockWidth}px` } as CSSProperties}
      >
        {/* From source only: the studio runs older code than its files. */}
        {!capturing && <CodeChangedBanner />}
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </div>
      {/* Desktop studio only — renders nothing in a plain browser. */}
      <StudioAgent onDock={setDockWidth} />
      {!capturing && <StudioToaster />}
    </QueryClientProvider>
  );
}
