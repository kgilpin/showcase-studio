import { ORIGIN } from "./content";
import { PORTAL_SIGN_IN_URL } from "./license-service";

/* The inline tags in content/*.yaml text: <strong>, <code>, <small>,
 * <mark> and <a href="...">, which components/Markup.tsx renders. Tags
 * don't nest. A link's href is a path or URL, or a name from LINKS. */
const LINKS: Record<string, string> = {
  // Stripe's Customer Portal sign-in: cancel, or change the card.
  portal: PORTAL_SIGN_IN_URL,
};

const TAG = /<([a-z]+)((?:\s+[a-z]+="[^"]*")*)>(.*?)<\/\1>/gs;

export type Tag = { tag: string; attrs: Record<string, string>; body: string };

/* The text split into plain runs and tags. */
export function parseMarkup(text: string): (string | Tag)[] {
  const parts: (string | Tag)[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const attrs: Record<string, string> = {};
    for (const [, name, value] of (m[2] ?? "").matchAll(/([a-z]+)="([^"]*)"/g)) {
      if (name && value !== undefined) attrs[name] = value;
    }
    parts.push({ tag: m[1]!, attrs, body: m[3]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/* Where a link goes. */
export function href(tag: Tag): string {
  const to = tag.attrs["href"] ?? "";
  return LINKS[to] ?? to;
}

/* The same text with no tags, for places that take plain text (search
 * engines' FAQ data). A link becomes "text: https://..." so the address
 * survives. */
export function plainText(text: string): string {
  return parseMarkup(text)
    .map((part) => {
      if (typeof part === "string") return part;
      if (part.tag !== "a") return part.body;
      const to = href(part);
      return `${part.body}: ${to.startsWith("/") ? ORIGIN + to : to}`;
    })
    .join("");
}
