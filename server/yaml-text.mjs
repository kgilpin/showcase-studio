/* Writing an edited YAML document back to text without disturbing what
 * the edit didn't touch.
 *
 * The yaml library keeps comments, blank lines, and quote styles, but it
 * writes block scalars itself. Line wrapping has to stay off (lineWidth 0
 * — a long authored line must not come back folded just because a
 * neighbouring field was edited), and with wrapping off a folded block
 * (`>`, `>-`) comes back as one long line. So after the library writes the
 * document, every folded or literal (`|`) block the edit left unchanged
 * gets its original text back.
 *
 *   const doc = parseEditable(text);   // parse, remembering the blocks
 *   doc.setIn([...], value);           // edit
 *   return editedText(doc);            // write, blocks as authored
 */
import { isMap, isScalar, isSeq, parseDocument } from "yaml";

const BLOCK_TYPES = new Set(["BLOCK_FOLDED", "BLOCK_LITERAL"]);

/** doc → Map(block scalar node → { value, source, indent }) */
const originalBlocks = new WeakMap();

/** The block scalars under `node`, each with its key path. */
function blockScalars(node, keys = [], found = []) {
  if (isMap(node)) {
    for (const pair of node.items) {
      blockScalars(pair.value, [...keys, isScalar(pair.key) ? pair.key.value : pair.key], found);
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, i) => blockScalars(item, [...keys, i], found));
  } else if (isScalar(node) && BLOCK_TYPES.has(node.type) && node.range) {
    found.push({ node, keys });
  }
  return found;
}

/** The indentation of the line that `offset` sits on. */
function indentAt(text, offset) {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  return /^ */.exec(text.slice(lineStart))[0].length;
}

/** Parses YAML text for editing, remembering the original text of every
 *  folded and literal block. */
export function parseEditable(text) {
  const doc = parseDocument(text);
  const blocks = new Map();
  for (const { node } of blockScalars(doc.contents)) {
    blocks.set(node, {
      value: node.value,
      source: text.slice(node.range[0], node.range[1]),
      indent: indentAt(text, node.range[0]),
    });
  }
  originalBlocks.set(doc, blocks);
  return doc;
}

/** A line with the spacing the library rewrites taken out: before a
 *  comment, and just inside brackets. */
const unspaced = (line) =>
  line
    .replace(/[ \t]+#/g, " #")
    .replace(/([{[])[ \t]+/g, "$1")
    .replace(/[ \t]+([}\]])/g, "$1");

/** Gives each line an edit didn't change its authored spacing back (the
 *  aligned comments of a say list). Falls back to `written` if that
 *  wouldn't mean exactly the same thing. */
export function keepLineSpacing(original, written) {
  const authored = new Map();
  for (const line of original.split("\n")) {
    const key = unspaced(line);
    /* Two spellings of one line: no telling which is which. */
    authored.set(key, authored.has(key) && authored.get(key) !== line ? null : line);
  }
  const text = written
    .split("\n")
    .map((line) => authored.get(unspaced(line)) ?? line)
    .join("\n");
  const [restored, meant] = [parseDocument(text), parseDocument(written)];
  const same =
    restored.errors.length === 0 &&
    JSON.stringify(restored.toJS()) === JSON.stringify(meant.toJS());
  return same ? text : written;
}

/** Writes an edited document: the library's output, with every folded
 *  and literal block the edit didn't change restored to its original
 *  text. Falls back to the library's output if the restored text would
 *  not mean exactly the same thing. */
export function editedText(doc) {
  const written = doc.toString({ lineWidth: 0 });
  const blocks = originalBlocks.get(doc);
  if (!blocks?.size) return written;

  const writtenDoc = parseDocument(written);
  const restores = [];
  for (const { node, keys } of blockScalars(doc.contents)) {
    const original = blocks.get(node);
    if (!original || node.value !== original.value) continue;
    const target = writtenDoc.getIn(keys, true);
    if (!isScalar(target) || !target.range || target.value !== original.value) continue;
    /* Same indentation, so the original lines still sit inside their parent. */
    if (indentAt(written, target.range[0]) !== original.indent) continue;
    restores.push({ start: target.range[0], end: target.range[1], source: original.source });
  }
  if (restores.length === 0) return written;

  let text = written;
  for (const { start, end, source } of restores.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, start) + source + text.slice(end);
  }
  try {
    const restored = parseDocument(text);
    const same =
      restored.errors.length === 0 &&
      JSON.stringify(restored.toJS()) === JSON.stringify(writtenDoc.toJS());
    return same ? text : written;
  } catch {
    return written;
  }
}
