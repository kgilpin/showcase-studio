/* What a theme.yaml may hold — its groups, the keys in each, and the CSS
 * variable each key sets. Plain ESM with no imports, like
 * watermark-rules.mjs, so the loader (src/content/showcases.ts) and the
 * studio's theme edits (server/edit-theme.mjs) read one copy. Types live
 * in theme-rules.d.mts; the model is documented in showcases.ts. */

/** Themeable keys, by group, mapped to the CSS variable each one sets. */
export const THEME_GROUPS = {
  colors: Object.fromEntries(
    [
      "background",
      "foreground",
      "card",
      "card-foreground",
      "primary",
      "primary-foreground",
      "secondary",
      "secondary-foreground",
      "muted",
      "muted-foreground",
      "accent",
      "accent-foreground",
      "border",
      "support",
      /* Overlay caption painting: the chip background, the text, and the
       * word being spoken (karaoke/reveal styles). */
      "caption-chip",
      "caption-text",
      "caption-word",
      /* The brand mark's wordmark (watermark.ts) — white unless set. */
      "watermark-text",
    ].map((name) => [name, name]),
  ),
  fonts: { display: "font-display", body: "font-body" },
  shape: { radius: "radius" },
  atmosphere: {
    "gradient-stage": "gradient-stage",
    "gradient-accent": "gradient-accent",
    "shadow-device": "shadow-device",
  },
};

/** Every `group.key` (and `extends`, `fonts.load`) a theme may set. */
export const THEME_KEYS = [
  "extends",
  ...Object.entries(THEME_GROUPS).flatMap(([group, keys]) =>
    Object.keys(keys).map((key) => `${group}.${key}`),
  ),
  "fonts.load",
];

/** What is wrong with one theme value, or null when it is fine. `key` is
 *  "extends", "fonts.load" or "<group>.<key>"; `file` names the theme in
 *  the message. */
export function themeValueProblem(key, value, file = "theme.yaml") {
  if (key === "extends") {
    return typeof value === "string"
      ? null
      : `"extends" in ${file} must be a showcase id (folder name under showcases/)`;
  }
  if (key === "fonts.load") {
    return Array.isArray(value) && value.every((url) => typeof url === "string")
      ? null
      : `"fonts.load" in ${file} must be a list of stylesheet URLs`;
  }
  const [group, name] = key.split(/\.(.*)/s);
  const keys = THEME_GROUPS[group];
  if (!keys) {
    return `Unknown section "${group}" in ${file} — expected: extends, ${Object.keys(THEME_GROUPS).join(", ")}`;
  }
  if (!(name in keys)) {
    return `Unknown ${group} key "${name}" in ${file} — themeable ${group} keys: ${Object.keys(keys).join(", ")}`;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return `"${key}" in ${file} must be a CSS value (got ${typeof value})`;
  }
  return null;
}

/** The first thing wrong with a parsed theme.yaml, or null. */
export function themeDocProblem(doc, file = "theme.yaml") {
  const groups = Object.keys(THEME_GROUPS);
  for (const key of Object.keys(doc)) {
    if (key !== "extends" && !groups.includes(key)) {
      return `Unknown section "${key}" in ${file} — expected: extends, ${groups.join(", ")}`;
    }
  }
  if (doc.extends != null) {
    const problem = themeValueProblem("extends", doc.extends, file);
    if (problem) return problem;
  }
  for (const [group, keys] of Object.entries(THEME_GROUPS)) {
    const section = doc[group];
    if (section == null) continue;
    if (typeof section !== "object" || Array.isArray(section)) {
      return `"${group}" in ${file} must be a map of ${Object.keys(keys).join(", ")}`;
    }
    for (const [key, value] of Object.entries(section)) {
      const problem = themeValueProblem(`${group}.${key}`, value, file);
      if (problem) return problem;
    }
  }
  return null;
}
