/* What a theme.yaml may hold — its groups, the keys in each, and the CSS
 * variable each key sets. Plain ESM with no imports, like
 * watermark-rules.mjs, so the loader (src/content/showcases.ts), the
 * studio's theme edits (server/edit-theme.mjs) and showcase.yaml's
 * schema (meta.theme) read one copy. THEME_SCHEMA is the same rules as
 * JSON Schema, which the studio writes into every library as
 * .studio/theme.schema.json for a session to read. Types live in
 * theme-rules.d.mts; the model is documented in showcases.ts.
 *
 * A theme that breaks a rule never fails its showcase: cleanTheme drops
 * what doesn't fit, and the loader warns about each thing it dropped. */

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

/** Every CSS variable a theme may set (also the valid meta.theme names). */
export const THEME_VARS = [
  ...new Set(Object.values(THEME_GROUPS).flatMap((keys) => Object.values(keys))),
];

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

/** A theme.yaml with what breaks a rule left out: `{theme, problems}`,
 *  one message per thing dropped — an unknown section or key, a value
 *  of the wrong kind, a group that isn't a map, a document that isn't
 *  one. Never throws. */
export function cleanTheme(doc, file = "theme.yaml") {
  const problems = [];
  if (doc == null) return { theme: {}, problems };
  if (typeof doc !== "object" || Array.isArray(doc)) {
    problems.push(`${file} must be a map of extends, ${Object.keys(THEME_GROUPS).join(", ")}`);
    return { theme: {}, problems };
  }
  const theme = {};
  for (const [key, section] of Object.entries(doc)) {
    if (key === "extends") {
      if (section == null) continue;
      const problem = themeValueProblem("extends", section, file);
      if (problem) problems.push(problem);
      else theme.extends = section;
      continue;
    }
    const keys = THEME_GROUPS[key];
    if (!keys) {
      problems.push(themeValueProblem(`${key}.`, "", file));
      continue;
    }
    if (section == null) continue;
    if (typeof section !== "object" || Array.isArray(section)) {
      problems.push(`"${key}" in ${file} must be a map of ${Object.keys(keys).join(", ")}`);
      continue;
    }
    const kept = {};
    for (const [name, value] of Object.entries(section)) {
      const problem = themeValueProblem(`${key}.${name}`, value, file);
      if (problem) problems.push(problem);
      else kept[name] = value;
    }
    theme[key] = kept;
  }
  return { theme, problems };
}

const GROUP_DESCRIPTIONS = {
  colors:
    "Colors, as CSS values. caption-* paint the overlay captions; watermark-text is the brand mark's wordmark.",
  fonts:
    "Font families, as CSS font-family values, plus stylesheets to load for families the app doesn't already load.",
  shape: "Corner radius, as a CSS length.",
  atmosphere: "Backgrounds and shadows: gradient-stage is the slide background.",
};

const cssValue = (description) => ({
  anyOf: [{ type: "string" }, { type: "number" }],
  ...(description ? { description } : {}),
});

/** The shape of theme.yaml as JSON Schema, made from THEME_GROUPS. */
export const THEME_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "theme.yaml",
  description:
    "A showcase's styling. Every key is optional; what a theme leaves out comes from the theme it extends, else the app's defaults. Change it with the studio's edit_theme tool. A key that isn't here, or a value of the wrong kind, is left out with a warning.",
  type: "object",
  additionalProperties: false,
  properties: {
    extends: {
      type: "string",
      description:
        "Another showcase's id (its folder name): start from its theme, with this one's keys on top.",
    },
    ...Object.fromEntries(
      Object.entries(THEME_GROUPS).map(([group, keys]) => [
        group,
        {
          type: "object",
          description: GROUP_DESCRIPTIONS[group],
          additionalProperties: false,
          properties: {
            ...Object.fromEntries(
              Object.entries(keys).map(([key, cssVar]) => [key, cssValue(`Sets --${cssVar}.`)]),
            ),
            ...(group === "fonts"
              ? {
                  load: {
                    type: "array",
                    items: { type: "string" },
                    description:
                      "Stylesheet URLs (Google Fonts, say) added to the showcase's pages.",
                  },
                }
              : {}),
          },
        },
      ]),
    ),
  },
};
