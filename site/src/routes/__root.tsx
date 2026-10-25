import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import styles from "../styles.css?url";

const DESCRIPTION =
  "Ship a feature. Show it off the same day. Showcase Studio is a Claude Code plugin for Mac and Windows that makes app videos from your repo in minutes.";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Showcase Studio" },
      { name: "description", content: DESCRIPTION },
      { name: "theme-color", content: "#121316" },
      { property: "og:title", content: "Showcase Studio" },
      { property: "og:url", content: "https://showcasestudio.dev/" },
      {
        property: "og:description",
        content:
          "Ship a feature. Show it off the same day. Claude makes the video from your repo in minutes.",
      },
      { property: "og:image", content: "https://showcasestudio.dev/media/hero.jpg" },
    ],
    links: [
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;700;800&display=swap",
      },
      { rel: "stylesheet", href: styles },
    ],
  }),
  shellComponent: Shell,
  component: Outlet,
  notFoundComponent: () => (
    <main className="download">
      <h2>Page not found</h2>
      <p>
        <a href="/">Go to the home page</a>
      </p>
    </main>
  ),
});

function Shell({ children }: { children: ReactNode }) {
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
