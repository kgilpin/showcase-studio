/* What the site tells search engines and AI tools in schema.org terms,
 * as <script type="application/ld+json"> blocks in each page's head. Every
 * fact comes from content/*.yaml, the same text the pages show, so the two
 * can't disagree:
 *
 *   every page   Organization and WebSite      shared.yaml
 *   / /pricing   SoftwareApplication           shared.yaml, pricing.yaml
 *   /            VideoObject (the hero video)  home.yaml
 *   /features    VideoObject per video section features.yaml, videos.yaml
 *   /videos      ItemList of VideoObject       videos.yaml
 *   /faq         FAQPage                       faq.yaml (in routes/faq.tsx)
 *
 * Leave out star ratings and reviews unless they are real: search engines
 * treat made-up ones as spam. Leave out the app's version too: the site
 * deploys apart from app releases, so it would go out of date. */
import { HOME, ORIGIN, PRICING, SITE, type Video } from "./content";
import { plainText } from "./markup";

const NAME = SITE.head.title;
const ORG_ID = `${ORIGIN}/#organization`;
const APP_ID = `${ORIGIN}/#app`;

/* One block for a page's head. */
export function jsonLd(data: object) {
  return { type: "application/ld+json", children: JSON.stringify(data) };
}

/* Who makes the site and the app, and the site itself. */
export function siteData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORG_ID,
        name: NAME,
        url: `${ORIGIN}/`,
        logo: `${ORIGIN}/icon.svg`,
        sameAs: [SITE.links.github, SITE.links.youtube],
      },
      {
        "@type": "WebSite",
        "@id": `${ORIGIN}/#website`,
        name: NAME,
        url: `${ORIGIN}/`,
        description: SITE.head.description,
        publisher: { "@id": ORG_ID },
      },
    ],
  };
}

/* The app: what it runs on and what it costs. The prices are the Pricing
 * page's own, so a price change there changes this too. */
export function appData() {
  const { trial, subscription } = PRICING.plans;
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": APP_ID,
    name: NAME,
    description: SITE.head.description,
    url: `${ORIGIN}/`,
    downloadUrl: `${ORIGIN}/download`,
    image: `${ORIGIN}/media/hero.jpg`,
    applicationCategory: "MultimediaApplication",
    // The two downloads on the Download page.
    operatingSystem: "macOS (Apple Silicon), Windows (x64)",
    softwareRequirements: "Claude Code",
    publisher: { "@id": ORG_ID },
    offers: [
      {
        "@type": "Offer",
        name: trial.name,
        price: price(trial.price),
        priceCurrency: "USD",
        description: plainText(trial.first),
        url: `${ORIGIN}/download`,
      },
      {
        "@type": "Offer",
        name: subscription.name,
        price: price(subscription.price),
        priceCurrency: "USD",
        description: plainText(subscription.first),
        url: `${ORIGIN}/pricing`,
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: price(subscription.price),
          priceCurrency: "USD",
          billingDuration: "P1M",
          unitText: "MONTH",
        },
      },
    ],
  };
}

/* The home page's hero video, which the site serves itself. */
export function heroVideoData() {
  const { video } = HOME.hero;
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: `${NAME} in under a minute`,
    description: video.label,
    thumbnailUrl: `${ORIGIN}/media/hero.jpg`,
    contentUrl: `${ORIGIN}/media/hero.mp4`,
    uploadDate: video.date,
    duration: duration(video.length),
    publisher: { "@id": ORG_ID },
  };
}

/* A video from content/videos.yaml, which plays from YouTube. */
export function videoData(video: Video) {
  return {
    "@type": "VideoObject",
    "@id": `${ORIGIN}/videos#${video.id}`,
    name: `${NAME}: ${video.title}`,
    description: plainText(video.text),
    thumbnailUrl: [
      `https://i.ytimg.com/vi/${video.youtube}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${video.youtube}/hqdefault.jpg`,
    ],
    uploadDate: video.date,
    duration: duration(video.length),
    embedUrl: `https://www.youtube.com/embed/${video.youtube}`,
    url: `https://www.youtube.com/watch?v=${video.youtube}`,
    publisher: { "@id": ORG_ID },
  };
}

/* Some videos on one page: the Features page's, or the Videos page's
 * whole list, in order. */
export function videoListData(videos: Video[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: videos.map((video, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: videoData(video),
    })),
  };
}

/* "$9.50" or "Free" as a number. Anything else stops the build, so a new
 * way of writing a price in pricing.yaml can't go out as a wrong one. */
function price(text: string) {
  if (/^free$/i.test(text.trim())) return "0";
  const match = /^\$(\d+(?:\.\d{2})?)$/.exec(text.trim());
  if (!match?.[1]) throw new Error(`pricing.yaml: can't read the price "${text}"`);
  return match[1];
}

/* "0:50" as an ISO 8601 duration, "PT0M50S". */
function duration(length: string) {
  const match = /^(\d+):(\d{2})$/.exec(length);
  if (!match) throw new Error(`A video's length should be m:ss, not "${length}"`);
  return `PT${Number(match[1])}M${Number(match[2])}S`;
}
