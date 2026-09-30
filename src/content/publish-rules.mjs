/* The text a showcase is posted with, and where it can be posted. Plain
 * ESM with no imports, like tiktok-fit-rules.mjs, so the Share page, the
 * studio's edit tool (server/edit-yaml.mjs) and the share tools
 * (server/share.mjs) read one copy. Types live in publish-rules.d.mts.
 *
 * The text lives in showcase.yaml's top-level `publish:` block: a default
 * for every destination, and overrides for each one.
 *
 *   publish:
 *     caption: Mirror your iPhone to any screen.   # every destination
 *     hashtags: [iphone, productivity]
 *     tiktok:    { hashtags: [iphone, techtok] }    # replaces the default list
 *     instagram: { caption: "… Link in bio." }
 *     youtube:   { title: Mirror your iPhone in 10 seconds }
 *
 *   field      default when nothing sets it
 *   --------   ------------------------------
 *   caption    meta.description
 *   hashtags   none
 *   title      meta.title (YouTube Shorts only)
 *
 * Hashtags are stored without the "#". The limits below are the
 * platforms' published ones; going over one is a problem the Share page
 * and share_status report, not a refusal — a draft may be saved long and
 * trimmed later. */

export const PUBLISH_FIELDS = ["caption", "hashtags", "title"];

/** Where a showcase can be posted. Every destination takes the 9:16
 *  full-quality video. `fields` are the ones the destination uses;
 *  `captionLimit` counts the caption and its hashtags together, the way
 *  the platform's own box does. */
export const DESTINATIONS = {
  tiktok: {
    label: "TikTok",
    uploadUrl: "https://www.tiktok.com/tiktokstudio/upload",
    uploadHint: "TikTok Studio's upload page",
    exportKind: "video",
    fields: ["caption", "hashtags"],
    /* TikTok's caption box drops blank lines from pasted text, and with
     * them whatever follows — so a paste for TikTok has none. */
    pasteBlankLines: false,
    captionLimit: 4000,
    maxSeconds: 600,
  },
  instagram: {
    label: "Instagram",
    uploadUrl: "https://www.instagram.com/",
    uploadHint: "Instagram — click Create (+), then Post; a video posts as a Reel",
    exportKind: "video",
    fields: ["caption", "hashtags"],
    captionLimit: 2200,
    maxHashtags: 30,
    maxSeconds: 180,
  },
  youtube: {
    label: "YouTube Shorts",
    uploadUrl: "https://www.youtube.com/upload",
    uploadHint: "YouTube Studio's upload dialog — a vertical video under 3 minutes is a Short",
    exportKind: "video",
    fields: ["title", "caption", "hashtags"],
    titleLimit: 100,
    captionLimit: 5000,
    /* YouTube ignores every hashtag on a video that has more than 60. */
    maxHashtags: 60,
    maxSeconds: 180,
  },
};

export const DESTINATION_IDS = Object.keys(DESTINATIONS);

/* Letters, digits and underscores, in any script — what the platforms
 * turn into a tag. */
const HASHTAG = /^[\p{L}\p{N}_]+$/u;

/** One hashtag as stored: no "#", no spaces. Returns null when `value`
 *  can't be a hashtag. */
export function normalizeHashtag(value) {
  if (typeof value !== "string") return null;
  const tag = value.trim().replace(/^#+/, "");
  return HASHTAG.test(tag) ? tag : null;
}

/** A hashtag list from an array or from text ("#a #b, c"), without
 *  duplicates (compared ignoring case). Throws with a plain message when
 *  an entry can't be a hashtag. */
export function normalizeHashtags(value) {
  const items =
    typeof value === "string"
      ? value.split(/[\s,]+/).filter(Boolean)
      : Array.isArray(value)
        ? value
        : null;
  if (items == null) throw new Error("hashtags must be a list of words");
  const seen = new Set();
  const tags = [];
  for (const item of items) {
    const tag = normalizeHashtag(item);
    if (tag == null) {
      throw new Error(
        `"${String(item)}" can't be a hashtag — use letters, digits and underscores, no spaces`,
      );
    }
    if (seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
  }
  return tags;
}

const isMap = (value) => value != null && typeof value === "object" && !Array.isArray(value);
const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** Hashtags as written, or undefined when they aren't a usable list. */
function tagsOf(value) {
  if (value == null) return undefined;
  try {
    return normalizeHashtags(value);
  } catch {
    return undefined;
  }
}

/** The text one destination posts with, and where each field came from
 *  ("tiktok" — its override, "publish" — the default, "meta" — the
 *  showcase's title or description, or "none"). `meta` is showcase.yaml's
 *  meta block. */
export function publishText(publish, destination, meta = {}) {
  const spec = DESTINATIONS[destination];
  if (!spec) throw new Error(`Unknown destination "${destination}"`);
  const block = isMap(publish) ? publish : {};
  const own = isMap(block[destination]) ? block[destination] : {};
  const pick = (field, read, fallback) => {
    if (read(own[field]) !== undefined) return [read(own[field]), destination];
    if (read(block[field]) !== undefined) return [read(block[field]), "publish"];
    if (fallback !== undefined) return [fallback, "meta"];
    return [undefined, "none"];
  };
  const [caption, captionFrom] = pick("caption", text, text(meta.description));
  const [hashtags, hashtagsFrom] = pick("hashtags", tagsOf);
  const result = {
    caption: caption ?? "",
    hashtags: hashtags ?? [],
    from: { caption: captionFrom, hashtags: hashtagsFrom },
  };
  if (spec.fields.includes("title")) {
    const [title, titleFrom] = pick("title", text, text(meta.title));
    result.title = title ?? "";
    result.from.title = titleFrom;
  }
  return result;
}

/** The caption box's text: the caption, then the hashtags ("#a #b"),
 *  with a blank line between. For a destination whose box drops pasted
 *  blank lines (TikTok) there are none: the hashtags follow the caption
 *  on its last line, and blank lines inside the caption become single
 *  line breaks. Either part may be missing. */
export function captionWithHashtags({ caption, hashtags }, destination) {
  const tags = hashtags.map((tag) => `#${tag}`).join(" ");
  if (DESTINATIONS[destination]?.pasteBlankLines === false) {
    const text = caption.replace(/\n[ \t]*(\n[ \t]*)+/g, "\n");
    return [text, tags].filter(Boolean).join(" ");
  }
  return [caption, tags].filter(Boolean).join("\n\n");
}

/** What would stop or hurt a post to `destination`, in plain sentences:
 *  a caption or title over the limit, too many hashtags, a video too long
 *  for the platform, a missing title. `durationMs` is the video's length,
 *  when known. */
export function publishProblems(destination, posted, { durationMs } = {}) {
  const spec = DESTINATIONS[destination];
  const problems = [];
  const captionLength = [...captionWithHashtags(posted, destination)].length;
  if (captionLength > spec.captionLimit) {
    problems.push(
      `The ${spec.label} caption with its hashtags is ${captionLength} characters — ` +
        `the limit is ${spec.captionLimit}.`,
    );
  }
  if (spec.maxHashtags && posted.hashtags.length > spec.maxHashtags) {
    problems.push(
      `${posted.hashtags.length} hashtags — ${spec.label} allows ${spec.maxHashtags}` +
        (destination === "youtube" ? " and ignores all of them past that." : "."),
    );
  }
  if (spec.fields.includes("title")) {
    const titleLength = [...(posted.title ?? "")].length;
    if (titleLength === 0) problems.push(`${spec.label} needs a title.`);
    if (titleLength > spec.titleLimit) {
      problems.push(`The title is ${titleLength} characters — the limit is ${spec.titleLimit}.`);
    }
  }
  if (durationMs != null && durationMs > spec.maxSeconds * 1000) {
    const minutes = (seconds) =>
      seconds % 60 === 0 ? `${seconds / 60} minutes` : `${Math.round(seconds)} seconds`;
    problems.push(
      `The video runs ${Math.round(durationMs / 1000)} seconds — ${spec.label} takes up to ` +
        `${minutes(spec.maxSeconds)}.`,
    );
  }
  return problems;
}

/** Checks one `publish.set` edit and returns the value to write, or
 *  `{ remove: true }` when the field goes back to inheriting. Throws with
 *  a plain message otherwise. */
export function checkPublishEdit({ destination, name, value }) {
  if (destination != null && !DESTINATIONS[destination]) {
    throw new Error(
      `Unknown destination "${destination}" — use one of: ${DESTINATION_IDS.join(", ")}, ` +
        "or leave it out for the default",
    );
  }
  const allowed = destination ? DESTINATIONS[destination].fields : PUBLISH_FIELDS;
  if (!allowed.includes(name)) {
    throw new Error(
      `publish${destination ? `.${destination}` : ""} has no field "${name}" — ` +
        `fields: ${allowed.join(", ")}`,
    );
  }
  if (value == null) return { remove: true };
  if (name === "hashtags") return { value: normalizeHashtags(value) };
  if (typeof value !== "string") throw new Error(`publish ${name} must be text`);
  const trimmed = value.trim();
  if (!trimmed) return { remove: true };
  if (name === "title" && trimmed.includes("\n")) throw new Error("A title is one line");
  return { value: trimmed };
}
