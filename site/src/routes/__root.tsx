import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { NotFound } from "../components/NotFound";
import { ORIGIN, SITE } from "../content";

import styles from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: SITE.head.title },
      { name: "description", content: SITE.head.description },
      { name: "theme-color", content: "#121316" },
      { property: "og:title", content: SITE.head.title },
      { property: "og:url", content: `${ORIGIN}/` },
      { property: "og:description", content: SITE.head.social_description },
      { property: "og:image", content: `${ORIGIN}/media/hero.jpg` },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE.head.title },
      { name: "twitter:card", content: "summary_large_image" },
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
  notFoundComponent: NotFound,
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
