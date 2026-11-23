/* The say list on its own: which words an entry matches, and what Polly
 * is sent for them. The build around it is in voiceover.test.mjs. */
import { describe, expect, it } from "vitest";
import { checkShowcase } from "../src/content/showcase-schema.mjs";
import { readSay, sayCaption } from "./voiceover-say.mjs";

const list = (say) => readSay(say, "say").entries;
const said = (text, say, library = {}) => sayCaption(text, [list(say), list(library)]).text;

describe("which words an entry matches", () => {
  it("matches whole words only", () => {
    const say = { records: "X" };
    expect(said("records recordsets myrecords records_2 records2", say)).toBe(
      "X recordsets myrecords records_2 records2",
    );
    expect(said("records. (records) re-records records's", say)).toBe("X. (X) re-X X's");
  });

  it("knows a word's edges in any alphabet", () => {
    expect(said("caf\u00e9 caf\u00e9s", { "caf\u00e9": "X" })).toBe("X caf\u00e9s");
    expect(said("na\u00efve", { na: "X" })).toBe("na\u00efve");
  });

  it("ignores case for a key with no capital after its first character", () => {
    expect(said("records Records RECORDS", { records: "X" })).toBe("X X X");
    expect(said("kubernetes Kubernetes", { Kubernetes: "X" })).toBe("X X");
  });

  it("wants the first character as written when there is a later capital", () => {
    expect(said("GitHub Github GITHUB github github.com", { GitHub: "X" })).toBe(
      "X X X github github.com",
    );
    expect(said("iPhone iphone IPhone", { iPhone: "X" })).toBe("X X IPhone");
  });

  it("matches a key in capitals only as written", () => {
    expect(said("IT it It", { IT: "I T" })).toBe("I T it It");
  });

  it("takes keys of several words, the longer winning", () => {
    const say = { records: "re cords", "the records": "the reckords" };
    expect(said("It records the  records.", say)).toBe("It re cords the reckords.");
  });

  it("takes a key with pattern characters as plain text", () => {
    expect(said("C++ and Node.js, not Nodexjs", { "C++": "C plus plus", "Node.js": "Node" })).toBe(
      "C plus plus and Node, not Nodexjs",
    );
  });

  it("never matches inside a replacement, or reads $ in one as a pattern", () => {
    expect(said("AppMap", { AppMap: "App Map", Map: "X" })).toBe("App Map");
    expect(said("cost", { cost: "$& $1" })).toBe("$& $1");
  });

  it("prefers the showcase's entry, and the key spelled as the caption is", () => {
    expect(said("GitHub", { github: "mine" }, { GitHub: "library's" })).toBe("mine");
    expect(said("US", { us: "X", US: "U S" })).toBe("U S");
  });

  it("lets a showcase turn a library entry off by repeating the word", () => {
    expect(sayCaption("On GitHub", [list({ GitHub: "GitHub" }), list({ GitHub: "X" })])).toEqual({
      text: "On GitHub",
    });
  });

  it("is the caption itself when nothing matches", () => {
    expect(sayCaption("A & B < C", [list({ GitHub: "X" }), []])).toEqual({ text: "A & B < C" });
  });
});

describe("SSML", () => {
  it("escapes the caption, a respelling beside it, and the sound", () => {
    const say = { "R&D": "R <and> D", "a&b": { ipa: 'x"&<' } };
    expect(sayCaption("R&D > a&b", [list(say)])).toMatchObject({
      ssml: true,
      ipa: ["a&b"],
      text:
        "<speak>R &lt;and&gt; D &gt; " +
        '<phoneme alphabet="ipa" ph="x&quot;&amp;&lt;">a&amp;b</phoneme></speak>',
    });
  });
});

describe("reading a list", () => {
  /* The build (readSay) and validate (the schema) each judge an entry. */
  it.each([
    ["a respelling", { GitHub: "Git Hub" }, true],
    ["a sound", { records: { ipa: "r\u026a" } }, true],
    ["no list", {}, true],
    ["a number", { GitHub: 12 }, false],
    ["nothing", { GitHub: null }, false],
    ["a blank", { GitHub: " " }, false],
    ["a list", { GitHub: ["Git", "Hub"] }, false],
    ["a map without ipa", { GitHub: { text: "Git Hub" } }, false],
    ["an empty ipa", { GitHub: { ipa: "" } }, false],
    ["an unknown field", { GitHub: { ipa: "x", engine: "neural" } }, false],
    ["not a map", "GitHub", false],
  ])("agrees with the schema on %s", (_name, say, good) => {
    const doc = { meta: { title: "T", voiceover: { say } }, scenes: [] };
    const schema = checkShowcase(doc).filter((p) => p.path.startsWith("meta.voiceover.say"));
    expect(schema.length === 0).toBe(good);
    expect(readSay(say, "say").warnings.length === 0).toBe(good);
  });

  it("keeps the ipa beside an unknown field", () => {
    expect(list({ a: { ipa: "x", other: 1 } })).toEqual([{ key: "a", ipa: "x" }]);
  });
});
