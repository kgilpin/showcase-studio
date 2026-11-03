/* The site's text, from content/*.yaml: one file per page, and shared.yaml
 * for what every page shares. The yaml plugin in vite.config.ts turns each
 * import into the file's data at build time; the types here say what each
 * file holds, and the pages read these constants, never the files.
 *
 * Text may carry the inline tags that src/markup.ts lists. */
import download from "../content/download.yaml";
import faq from "../content/faq.yaml";
import features from "../content/features.yaml";
import home from "../content/home.yaml";
import pricing from "../content/pricing.yaml";
import site from "../content/shared.yaml";

export const ORIGIN = "https://showcasestudio.dev";

/* A page's name and description, for the browser tab, search results and
 * shared links. */
export type Head = { title: string; description: string };

export type Page = "features" | "faq" | "pricing" | "download";

export type SiteContent = {
  head: Head & { social_description: string };
  brand: { name: string; mark: string };
  nav: Record<Page, string> & { manage: string };
  try: { title: string; lede: string; button: string };
  install: {
    plugin: { pill: string; title: string; intro: string; commands: string; then: string };
    app: {
      title: string;
      steps: { art: InstallArt; lead: string; text: string }[];
      mac: string;
      windows: string;
      checksums: string;
    };
  };
  not_found: { head: Head; title: string; lede: string };
};

/* The picture beside each desktop-app install step (InstallOptions.tsx). */
export type InstallArt = "download" | "open" | "chat";

/* A window with a title bar and preformatted text (components/Window.tsx):
 * <dir>, <note>, <sha> and <pin>n</pin> in the text. */
export type WindowArt = { type: "window"; title: string; label: string; text: string };

export type HomeArt =
  | WindowArt
  | { type: "chat"; you: string; tool: string; claude: string; frame: { src: string; alt: string } }
  | {
      type: "timeline";
      label: string;
      scenes: { src: string; kind: "Screenshot" | "Clip"; caption: string }[];
      voice: string;
    }
  | { type: "image"; src: string; alt: string; width: number; height: number }
  | { type: "destinations" };

export type HomeContent = {
  hero: {
    eyebrow: string;
    headline: string[][];
    lede: string;
    button: string;
    video: { label: string; caption: string };
  };
  features: { title: string; text: string[]; art: HomeArt }[];
  more: string;
  download: { title: string };
};

export type StageArt =
  | WindowArt
  | { type: "fit"; label: string }
  | { type: "graphics"; label: string; you: string; tool: string; mark: string }
  | { type: "voice"; label: string; caption: string; lit: string; take: string; ai: string }
  | {
      type: "social";
      label: string;
      caption: string;
      styles: string[];
      style: string;
      end: { title: string; line: string; button: string };
    }
  | {
      type: "edit";
      label: string;
      title: string;
      caption: string;
      background: string;
      views: string[];
      view: string;
    }
  | { type: "share"; label: string; exports: string[] };

export type Stage = {
  id: string;
  title: string;
  items: { feature: string; text: string }[];
  art: StageArt;
};

export type FeaturesContent = { head: Head; title: string; stages: Stage[] };

export type Question = { q: string; a: string };

export type FaqContent = { head: Head; title: string; questions: Question[] };

export type PricingContent = {
  head: Head;
  title: string;
  lede: string;
  plans: {
    trial: { name: string; price: string; first: string; button: string };
    subscription: {
      name: string;
      price: string;
      per: string;
      first: string;
      button: string;
      note: string;
    };
  };
  included: string[];
  questions_title: string;
  questions: Question[];
};

export type DownloadContent = { head: Head; title: string; lede: string; next: string };

export const SITE = site as SiteContent;
export const HOME = home as HomeContent;
export const FEATURES = features as FeaturesContent;
export const FAQ = faq as FaqContent;
export const PRICING = pricing as PricingContent;
export const DOWNLOAD = download as DownloadContent;

/* A page's <head>: its title with the site's name after it, its
 * description, the same for shared links, and its canonical address. */
export function pageHead(path: string, head: Head) {
  const title = `${head.title} · ${SITE.head.title}`;
  return {
    meta: [
      { title },
      { name: "description", content: head.description },
      { property: "og:title", content: title },
      { property: "og:url", content: ORIGIN + path },
      { property: "og:description", content: head.description },
    ],
    links: [{ rel: "canonical", href: ORIGIN + path }],
  };
}
