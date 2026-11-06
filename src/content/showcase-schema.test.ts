import { describe, expect, it } from "vitest";
import { checkShowcase, SHOWCASE_SCHEMA } from "./showcase-schema.mjs";
import { CAPTION_PRESETS } from "./caption-position-rules.mjs";
import { TIKTOK_FITS } from "./tiktok-fit-rules.mjs";
import { WATERMARK_POSITIONS } from "./watermark-rules.mjs";
import { DESTINATIONS, PUBLISH_FIELDS } from "./publish-rules.mjs";

/* The schema check: what doesn't fit showcase.yaml's shape, said so a
 * reader knows where the field goes instead. */

const doc = (scenes: unknown[], extra: Record<string, unknown> = {}) => ({
  meta: { title: "T", description: "d", loop: false },
  scenes,
  ...extra,
});

const messages = (value: unknown) => checkShowcase(value).map((problem) => problem.message);

/** The schema as the test walks it. */
type Node = {
  $schema?: string;
  description?: string;
  enum?: readonly string[];
  properties?: Record<string, Node>;
  items?: Node;
  anyOf?: Node[];
};
const schema = SHOWCASE_SCHEMA as unknown as Node;
const at = (node: Node | undefined, ...keys: string[]): Node =>
  keys.reduce<Node>((here, key) => {
    const next = key === "[]" ? here.items : here.properties?.[key];
    if (!next) throw new Error(`no ${key} in the schema`);
    return next;
  }, node ?? schema);

describe("checkShowcase", () => {
  it("passes a well-formed showcase, every shape of take included", () => {
    expect(
      checkShowcase(
        doc(
          [
            {
              id: "hook",
              theme: "footage",
              take: { from: 0.45, to: 3.75 },
              captions: [{ text: "Hi", position: "top" }],
              media: { kind: "video", asset: "clip-hook", alt: "On camera" },
            },
            {
              id: "list",
              theme: "footage",
              take: [
                { from: 0, to: 1 },
                { from: 2, to: 3, fit: 0.5 },
              ],
            },
            {
              id: "card",
              theme: "statement",
              take: { silence: 2 },
              title: "Hello",
              watermark: false,
            },
            {
              id: "sides",
              theme: "footage",
              take: { audio: { from: 0, to: 2 }, video: [{ from: 0, to: 2 }], clip: false },
              media: {
                kind: "image",
                asset: "shot",
                alt: "a",
                tiktok: { fit: "fill", focus: "40%" },
              },
            },
          ],
          {
            publish: {
              caption: "c",
              hashtags: ["a"],
              youtube: { title: "t" },
              tiktok: { hashtags: "x y" },
            },
          },
        ),
      ),
    ).toEqual([]);
  });

  it("names where a misplaced field belongs", () => {
    const problems = checkShowcase(
      doc([{ id: "cut", theme: "footage", clip: false, take: { from: 1, to: 2 } }]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "unknown", path: "scenes[0].clip", sceneIndex: 0 });
    expect(problems[0]?.message).toBe(
      'scenes[0]: "clip" isn\'t a scene field — it belongs in scenes[].take (scenes[].take.clip)',
    );
    expect(messages(doc([{ id: "a", tiktok: { fit: "fill" } }]))).toEqual([
      'scenes[0]: "tiktok" isn\'t a scene field — it belongs in scenes[].media (scenes[].media.tiktok)',
    ]);
    /* The nearest home: a title inside publish.tiktok is publish's. */
    expect(messages(doc([], { publish: { tiktok: { title: "t" } } }))).toEqual([
      'publish.tiktok: "title" isn\'t a publish.tiktok field — it belongs in publish (publish.title)',
    ]);
    expect(messages(doc([], { title: "t" }))).toEqual([
      'the document: "title" isn\'t a showcase.yaml field — it belongs in meta (meta.title)',
    ]);
  });

  it("spots a typo, and lists the fields when nothing fits", () => {
    expect(messages(doc([{ id: "a", captoins: [] }]))).toEqual([
      'scenes[0]: "captoins" isn\'t a scene field — did you mean "captions"?',
    ]);
    expect(messages(doc([{ id: "a", take: { from: 0, to: 1, bogus: true } }]))).toEqual([
      'scenes[0].take: "bogus" isn\'t a span field — the fields are from, to, fit, clip',
    ]);
  });

  it("reports the wrong kind of value, choices and ranges", () => {
    expect(messages(doc([{ id: "a", captions: [{ text: 3 }] }]))).toEqual([
      "scenes[0].captions[0].text: 3 isn't text",
    ]);
    expect(
      messages(doc([{ id: "a", media: { kind: "image", asset: "s", alt: "a", fit: "fil" } }])),
    ).toEqual(['scenes[0].media.fit: "fil" isn\'t one of cover, contain']);
    expect(messages(doc([{ id: "a", take: "1-2" }]))).toEqual([
      'scenes[0].take: "1-2" isn\'t a map or a list',
    ]);
    expect(messages(doc([{ id: "a", watermark: "yes" }]))).toEqual([
      'scenes[0].watermark: "yes" isn\'t true or false or a map',
    ]);
    expect(
      messages({ meta: { title: "T", source: { video: "v", speed: 3 } }, scenes: [] }),
    ).toEqual(["meta.source.speed: 3 is outside 0.5 to 2"]);
    expect(checkShowcase(doc([{ id: "a", captions: [{ text: "x", position: "14%" }] }]))).toEqual(
      [],
    );
    expect(messages(doc([{ id: "a", captions: [{ text: "x", position: "high" }] }]))).toEqual([
      `scenes[0].captions[0].position: "high" isn't one of ${CAPTION_PRESETS.join(", ")} or a percentage like "14%"`,
    ]);
  });

  it("reports what is missing, and never throws", () => {
    expect(messages({ meta: {}, scenes: [{ theme: "footage" }] })).toEqual([
      "meta: needs title",
      "scenes[0]: needs id",
    ]);
    expect(messages({ scenes: [] })).toEqual(["the document: needs meta"]);
    expect(messages("nope")).toEqual(["showcase.yaml must be a map with meta and scenes"]);
    expect(messages(null)).toHaveLength(1);
  });

  it("marks each problem with its scene, so a warning lands on the right slide", () => {
    const problems = checkShowcase(
      doc([
        { id: "a", theme: "footage" },
        { id: "b", theme: "footage", nope: 1, take: { from: 1, to: 2, clip: "yes" } },
      ]),
    );
    expect(problems.map((problem) => [problem.sceneIndex, problem.kind])).toEqual([
      [1, "unknown"],
      [1, "type"],
    ]);
  });
});

describe("SHOWCASE_SCHEMA", () => {
  const scene = at(undefined, "scenes", "[]");
  const meta = at(undefined, "meta");

  it("takes its choices from the rule files, never a retyped copy", () => {
    expect(at(scene, "captions", "[]", "position").anyOf?.[0]?.enum).toBe(CAPTION_PRESETS);
    expect(at(scene, "media", "tiktok", "fit").enum).toBe(TIKTOK_FITS);
    expect(at(at(meta, "watermark").anyOf?.[1], "position").enum).toBe(WATERMARK_POSITIONS);
    const publish = at(undefined, "publish");
    expect(Object.keys(publish.properties ?? {})).toEqual([
      ...PUBLISH_FIELDS,
      ...Object.keys(DESTINATIONS),
    ]);
    for (const [id, destination] of Object.entries(DESTINATIONS)) {
      expect(Object.keys(at(publish, id).properties ?? {})).toEqual(destination.fields);
    }
  });

  it("is plain JSON, with a one-line description on the fields a reader meets", () => {
    const json = JSON.parse(JSON.stringify(SHOWCASE_SCHEMA)) as Node;
    expect(json.$schema).toContain("json-schema.org");
    expect(at(json, "scenes", "[]", "take").description).toContain("clip goes inside it");
    for (const name of ["meta", "scenes", "publish"]) {
      expect(typeof at(json, name).description).toBe("string");
    }
    for (const [name, field] of Object.entries(at(json, "scenes", "[]").properties ?? {})) {
      expect(field.description ?? field.anyOf?.[0]?.description, name).toBeDefined();
    }
  });
});
