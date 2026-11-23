/* How a word is said in a synthesized voiceover (issue #83): the "say"
 * list, from meta.voiceover.say and the library's showcase_settings.yaml.
 *
 *   caption text ──► shown on screen, unchanged
 *        │
 *        └──► sayCaption ──► the text sent to Polly (voiceover.mjs)
 *                       └──► which spoken words stand for which caption
 *                            words, so the karaoke times still fit
 *
 *   say:
 *     GitHub: Git Hub                  # a respelling
 *     records: { ipa: "rɪˈkɔːrdz" }    # an exact sound, sent as SSML
 *
 * Which words an entry matches:
 *   - whole words only: "records" is not in "recordsets", and is in
 *     "records." and "re-records". A key may be several words.
 *   - a key with no capital after its first character ("records",
 *     "Kubernetes") matches in any case.
 *   - a key in capitals ("IT", "SQL") matches only as written, so "IT"
 *     never changes "it" or "It".
 *   - any other key with a later capital ("GitHub", "iPhone") needs its
 *     first character as written, and the rest in any case: "GitHub"
 *     matches "Github" and "GITHUB", never "github", which is how
 *     addresses and commands spell it.
 *
 * Where two entries want the same words, the showcase's beats the
 * library's; in one list the longer key wins, then the key spelled as
 * the caption spells it. A replacement is never matched again.
 *
 * An ipa entry works on every engine. AWS's tag table calls <phoneme>
 * "partial" on the generative engine, and its phoneme page leaves that
 * engine out, so it was tried (2026-11-22): a sound nothing like the
 * word ("bəˈnænəz" for "records") was spoken as written on generative
 * and on neural. If Polly ever refuses one, the build's error names the
 * entry and the engine.
 *
 * A bad entry is left out with a warning; it never stops a build. In a
 * showcase, validate's warning comes from the schema
 * (src/content/showcase-schema.mjs). */

/** Reads one say list. `where` names it in the warnings. Returns
 *  `{entries, warnings}`, each entry {key, text} or {key, ipa}. */
export function readSay(raw, where) {
  if (raw == null) return { entries: [], warnings: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      entries: [],
      warnings: [`${where} must be a map, e.g. {GitHub: Git Hub}. It is ignored`],
    };
  }
  const entries = [];
  const warnings = [];
  for (const [name, value] of Object.entries(raw)) {
    const at = `${where}.${name}`;
    const key = name.trim();
    if (!key) {
      warnings.push(`${where} has an entry with no word. It is ignored`);
    } else if (typeof value === "string" && value.trim()) {
      entries.push({ key, text: value.trim() });
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const field of Object.keys(value)) {
        if (field !== "ipa") {
          warnings.push(`${at}: "${field}" isn't a say field (the field is ipa). It is ignored`);
        }
      }
      if (typeof value.ipa === "string" && value.ipa.trim()) {
        entries.push({ key, ipa: value.ipa.trim() });
      } else {
        warnings.push(`${at} needs ipa, as text. The entry is ignored`);
      }
    } else {
      warnings.push(`${at} must be text or {ipa: "..."}. The entry is ignored`);
    }
  }
  return { entries, warnings };
}

const escapePattern = (text) => text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

/** A function that finds every place an entry's key matches in a text. */
function matcher({ key }) {
  const [first, ...rest] = key;
  const laterCapital = /\p{Lu}/u.test(rest.join(""));
  const asWritten = laterCapital && !/\p{Ll}/u.test(key);
  const words = key.split(/\s+/).map(escapePattern).join("\\s+");
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}\\p{M}_])${words}(?![\\p{L}\\p{N}\\p{M}_])`,
    asWritten ? "gu" : "giu",
  );
  return (text) =>
    [...text.matchAll(pattern)]
      .filter((match) => !laterCapital || match[0].startsWith(first))
      .map((match) => ({ start: match.index, end: match.index + match[0].length, word: match[0] }));
}

/** The replacements in one caption, in order, none overlapping. `lists`
 *  is strongest first: the showcase's, then the library's. */
function findHits(text, lists) {
  const taken = [];
  for (const entries of lists) {
    const found = entries
      .flatMap((entry) => matcher(entry)(text).map((match) => ({ ...match, entry })))
      .sort(
        (a, b) =>
          b.end - b.start - (a.end - a.start) ||
          Number(b.entry.key === b.word) - Number(a.entry.key === a.word),
      );
    for (const hit of found) {
      if (!taken.some((other) => hit.start < other.end && other.start < hit.end)) taken.push(hit);
    }
  }
  /* An entry that says a word as it is written changes nothing: it is
   * how a showcase opts out of one of the library's. */
  return taken.filter((hit) => hit.entry.text !== hit.word).sort((a, b) => a.start - b.start);
}

const escapeText = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (text) => escapeText(text).replace(/"/g, "&quot;");

/** `text` from `start` to `end`, with each hit swapped for `swap(hit)`
 *  and everything between passed through `keep`. */
function swapped(text, hits, { swap, keep = (part) => part, start = 0, end = text.length }) {
  let at = start;
  let out = "";
  for (const hit of hits) {
    out += keep(text.slice(at, hit.start)) + swap(hit);
    at = hit.end;
  }
  return out + keep(text.slice(at, end));
}

/** The caption cut at spaces, the words one hit covers kept together:
 *  `{shown}` for a piece said as written, `{shown, said}` for a replaced
 *  one. "GitHub's CLI" is [{shown: "GitHub's", said: "Git Hub's"},
 *  {shown: "CLI"}]. */
function piecesOf(text, hits) {
  const units = [];
  for (const { 0: token, index } of text.matchAll(/\S+/g)) {
    const end = index + token.length;
    const own = hits.filter((hit) => hit.start >= index && hit.start < end);
    const last = units.at(-1);
    if (last?.hits.at(-1)?.end > index) {
      last.end = end;
      last.hits.push(...own);
    } else {
      units.push({ start: index, end, hits: own });
    }
  }
  return units.map(({ start, end, hits: own }) => {
    const shown = text.slice(start, end);
    if (own.length === 0) return { shown };
    /* An ipa entry changes the sound, and whisper hears the word. */
    const swap = (hit) => hit.entry.text ?? hit.word;
    return { shown, said: swapped(text, own, { swap, start, end }) };
  });
}

/** What Polly is sent for a caption. With nothing to replace it is
 *  `{text}`, the caption itself. Else `text` is the respelled caption,
 *  or SSML (`ssml: true`, `ipa` naming the entries used) when an ipa
 *  entry applies, and `pieces` maps it back to the caption's words. */
export function sayCaption(text, lists) {
  const hits = findHits(text, lists);
  if (hits.length === 0) return { text };
  const pieces = piecesOf(text, hits);
  const ipa = [...new Set(hits.filter((hit) => hit.entry.ipa).map((hit) => hit.entry.key))];
  if (ipa.length === 0) {
    return { text: swapped(text, hits, { swap: (hit) => hit.entry.text }), pieces };
  }
  const swap = ({ word, entry }) =>
    entry.ipa
      ? `<phoneme alphabet="ipa" ph="${escapeAttribute(entry.ipa)}">${escapeText(word)}</phoneme>`
      : escapeText(entry.text);
  return {
    text: `<speak>${swapped(text, hits, { swap, keep: escapeText })}</speak>`,
    ssml: true,
    ipa,
    pieces,
  };
}
