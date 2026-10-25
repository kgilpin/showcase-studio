import { beforeAll, describe, expect, it } from "vitest";
import {
  loadFromSource,
  showcaseAssets,
  showcasesReady,
  showcaseWarnings,
  type Showcase,
} from "./showcases";
import type { ShowcaseAsset, ShowcaseData } from "./source";

/* The loader, end to end: YAML text and an asset list in, the resolved
 * showcase, its warnings and its asset usage out. */

function assets(id: string, ...files: string[]): Map<string, ShowcaseAsset> {
  const map = new Map<string, ShowcaseAsset>();
  for (const name of files) {
    const asset = { url: `/data/${id}/assets/${name}`, file: `${id}/assets/${name}` };
    map.set(name, asset);
    map.set(name.replace(/\.[^.]+$/, ""), asset);
  }
  return map;
}

function data(id: string, yaml: string, files: string[]): ShowcaseData {
  return { id, yaml, assets: assets(id, ...files), words: new Map(), graphics: new Map() };
}

async function load(id: string, yaml: string, files: string[] = []): Promise<Showcase> {
  const [showcase] = await loadFromSource({ load: async () => [data(id, yaml, files)] });
  if (!showcase) throw new Error(`"${id}" did not load`);
  return showcase;
}

const warningsFor = (sceneId: string) =>
  showcaseWarnings.filter((warning) => warning.sceneId === sceneId).map(({ message }) => message);

/* The module loads the bundled library on import; let that finish so it
 * can't land on top of a test's load. */
beforeAll(() => showcasesReady);

describe("loading a showcase", () => {
  it("turns YAML into scenes with resolved media and timing", async () => {
    const showcase = await load(
      "plain",
      `
meta:
  title: Plain
  description: A plain showcase
scenes:
  - id: hello
    theme: feature
    title: Hello
    media: { kind: image, asset: shot, alt: A screenshot }
    captions:
      - text: One two three four five.
  - id: clip
    theme: footage
    media: { kind: video, asset: talk, alt: A clip }
    captions:
      - text: Spoken over the clip.
`,
      ["shot.png", "talk.mp4"],
    );
    expect(showcase.title).toBe("Plain");
    expect(showcase.scenes.map((scene) => scene.id)).toEqual(["hello", "clip"]);
    const [hello, clip] = showcase.scenes;
    expect(hello!.media).toMatchObject({
      kind: "image",
      src: "/data/plain/assets/shot.png",
      file: "plain/assets/shot.png",
    });
    expect(clip!.media).toMatchObject({ kind: "video", src: "/data/plain/assets/talk.mp4" });
    expect(hello!.durationMs).toBeGreaterThan(0);
    expect(hello!.body).toBe("One two three four five.");
    /* footage stays out of the App Store screenshot set by default. */
    expect(showcase.exportScenes.map((scene) => scene.id)).toEqual(["hello"]);
    expect(showcaseWarnings).toEqual([]);
  });

  it("keeps caption presets and exact heights, and warns about unknown positions", async () => {
    const showcase = await load(
      "placed",
      `
meta:
  title: Placed
  description: d
scenes:
  - id: one
    theme: feature
    captions:
      - { text: Top, position: top }
      - { text: Exact, position: 14% }
      - { text: Unknown, position: middle }
      - { text: Too low, position: 95% }
`,
    );
    const positions = showcase.scenes[0]!.captions.map((caption) => caption.position);
    expect(positions).toEqual(["top", "14%", undefined, undefined]);
    expect(warningsFor("one")).toEqual([
      expect.stringContaining('captions[2].position "middle"'),
      expect.stringContaining('captions[3].position "95%"'),
    ]);
  });

  it("lists a media key with no file as missing, used by its scene", async () => {
    const showcase = await load(
      "gap",
      `
meta: { title: Gap, description: d }
scenes:
  - id: one
    theme: feature
    media: { kind: image, asset: not-there, alt: Missing }
    captions: [{ text: Hi }]
`,
    );
    expect(showcaseAssets(showcase).missing).toEqual([{ key: "not-there", usedBy: ["one"] }]);
  });
});

describe("the brand mark", () => {
  const YAML = `
meta:
  title: Marked
  description: d
  watermark: { asset: MARK, text: Brand }
scenes:
  - id: one
    theme: feature
    captions: [{ text: Hi }]
  - id: two
    theme: feature
    watermark: { asset: alt-mark }
    captions: [{ text: Hi }]
  - id: three
    theme: feature
    watermark: { asset: gone-too }
    captions: [{ text: Hi }]
  - id: off
    theme: feature
    watermark: false
    captions: [{ text: Hi }]
`;

  it("gives every scene the showcase's mark, with per-scene overrides", async () => {
    const showcase = await load("marked", YAML.replace("MARK", "logo"), [
      "logo.png",
      "alt-mark.png",
    ]);
    const [one, two, , off] = showcase.scenes;
    expect(one!.watermark).toMatchObject({
      src: "/data/marked/assets/logo.png",
      text: "Brand",
      position: "top-left",
    });
    expect(two!.watermark).toMatchObject({ src: "/data/marked/assets/alt-mark.png" });
    expect(off!.watermark).toBeUndefined();
  });

  it("counts the showcase's mark and a scene's own mark as used", async () => {
    const showcase = await load("marked", YAML.replace("MARK", "logo"), [
      "logo.png",
      "alt-mark.png",
    ]);
    const usedBy = Object.fromEntries(
      showcaseAssets(showcase).assets.map((asset) => [asset.name, asset.usedBy]),
    );
    expect(usedBy).toEqual({ "logo.png": ["watermark"], "alt-mark.png": ["two"] });
  });

  it("lists missing mark files as missing, and still draws the wordmark", async () => {
    const showcase = await load("marked", YAML.replace("MARK", "no-such-mark"), ["alt-mark.png"]);
    expect(showcaseAssets(showcase).missing).toEqual([
      { key: "no-such-mark", usedBy: ["watermark"] },
      { key: "gone-too", usedBy: ["three"] },
    ]);
    const one = showcase.scenes[0]!;
    expect(one.watermark?.src).toBeUndefined();
    expect(one.watermark?.text).toBe("Brand");
  });

  it("warns about the showcase's missing mark once, not once per scene", async () => {
    await load("marked", YAML.replace("MARK", "no-such-mark"), ["alt-mark.png"]);
    const about = (key: string) =>
      showcaseWarnings.filter((warning) => warning.message.includes(`"${key}"`));
    expect(about("no-such-mark").map((warning) => warning.sceneId)).toEqual([""]);
    expect(warningsFor("three")).toHaveLength(1);
    expect(warningsFor("three")[0]).toContain('"gone-too"');
    expect(warningsFor("one")).toEqual([]);
  });

  it("warns when the mark's file is not an image, and draws the wordmark alone", async () => {
    const showcase = await load("marked", YAML.replace("MARK", "logo"), [
      "logo.mp4",
      "alt-mark.png",
    ]);
    expect(warningsFor("")).toEqual([expect.stringContaining('"logo" is a video file')]);
    const one = showcase.scenes[0]!;
    expect(one.watermark?.src).toBeUndefined();
    expect(one.watermark?.text).toBe("Brand");
    /* Still referenced, so the assets page must not call it unused. */
    expect(
      showcaseAssets(showcase).assets.find((asset) => asset.name === "logo.mp4")?.usedBy,
    ).toEqual(["watermark"]);
  });

  it("warns when meta.watermark has neither an asset nor text", async () => {
    await load(
      "bare",
      `
meta:
  title: Bare
  description: d
  watermark: { position: top-right, opacity: 0.4 }
scenes:
  - id: one
    theme: feature
    captions: [{ text: Hi }]
`,
    );
    expect(warningsFor("")).toEqual([expect.stringContaining("needs an asset, a text wordmark")]);
  });

  it("drops the image or the wordmark on a scene that sets it empty", async () => {
    const showcase = await load(
      "marked",
      `
meta:
  title: Marked
  description: d
  watermark: { asset: logo, text: Brand }
scenes:
  - id: image-only
    theme: feature
    watermark: { text: "" }
    captions: [{ text: Hi }]
  - id: text-only
    theme: feature
    watermark: { asset: "" }
    captions: [{ text: Hi }]
`,
      ["logo.png"],
    );
    const [imageOnly, textOnly] = showcase.scenes;
    expect(imageOnly!.watermark).toMatchObject({ src: "/data/marked/assets/logo.png" });
    expect(imageOnly!.watermark?.text).toBeUndefined();
    expect(textOnly!.watermark?.text).toBe("Brand");
    expect(textOnly!.watermark?.src).toBeUndefined();
    expect(showcaseWarnings).toEqual([]);
  });
});

describe("the voiceover's word timings", () => {
  /* assets/<soundtrack-src>.words.json is found by name — nothing in the
   * YAML points at it — so the assets page has to know the convention or
   * it invites deleting the file the karaoke captions depend on. */
  const YAML = `
meta:
  title: Voiced
  description: A voiced showcase.
  soundtrack: { src: voiceover, volume: 1, sync: true }
scenes:
  - id: one
    theme: statement
    title: Hello
    captions:
      - text: A spoken line.
`;

  it("counts the sidecar as used by the soundtrack", async () => {
    const showcase = await load("voiced", YAML, [
      "voiceover.m4a",
      "voiceover.words.json",
      "stray.words.json",
    ]);
    const usage = Object.fromEntries(
      showcaseAssets(showcase).assets.map((asset) => [asset.name, asset.usedBy]),
    );
    expect(usage["voiceover.m4a"]).toEqual(["soundtrack"]);
    expect(usage["voiceover.words.json"]).toEqual(["word timings"]);
    /* A sidecar for some other audio is still genuinely unreferenced. */
    expect(usage["stray.words.json"]).toEqual([]);
  });

  it("does not invent a sidecar when the showcase has no soundtrack", async () => {
    const showcase = await load("silent", YAML.replace(/\n {2}soundtrack:.*/, ""), [
      "voiceover.words.json",
    ]);
    expect(
      showcaseAssets(showcase).assets.find((a) => a.name === "voiceover.words.json")?.usedBy,
    ).toEqual([]);
  });
});

describe("a soundtrack's volume", () => {
  const yaml = (soundtrack: string) => `
meta:
  title: Voiced
  description: A voiced showcase.
  soundtrack: ${soundtrack}
scenes:
  - id: one
    theme: statement
    title: Hello
    captions:
      - text: A spoken line.
`;

  /* The edit tools write { src, sync } with no volume, and the player
   * hands the value straight to an <audio> element, which throws on
   * anything that isn't a finite number — taking the page down with it. */
  it("is full volume when the file doesn't say", async () => {
    const showcase = await load("voiced", yaml("{ src: voiceover, sync: true }"), [
      "voiceover.m4a",
    ]);
    expect(showcase.soundtrack).toMatchObject({ volume: 1, sync: true });
    expect(showcase.soundtrack!.src).toBe("/data/voiced/assets/voiceover.m4a");
  });

  it("keeps a volume the file sets, and pulls a wild one into range", async () => {
    const quiet = await load("voiced", yaml("{ src: voiceover, volume: 0.2 }"), ["voiceover.m4a"]);
    expect(quiet.soundtrack).toMatchObject({ volume: 0.2 });
    for (const [written, used] of [
      ["4", 1],
      ["-1", 0],
      ["loud", 1],
    ] as const) {
      const showcase = await load("voiced", yaml(`{ src: voiceover, volume: ${written} }`), [
        "voiceover.m4a",
      ]);
      expect(showcase.soundtrack).toMatchObject({ volume: used });
    }
  });
});

describe("a theme value YAML cut short", () => {
  const yaml = (title: string) => `
meta:
  title: ${title}
  description: A themed showcase.
scenes:
  - id: one
    theme: statement
    title: Hello
`;

  /* Unquoted, "linear-gradient(100deg, #34e7d6, #0a8f95)" arrives as
   * "linear-gradient(100deg," — a space and # start a YAML comment. */
  const parentTheme = `
colors:
  primary: "#34e7d6"
atmosphere:
  gradient-accent: linear-gradient(100deg, #34e7d6, #0a8f95)
`;

  it("is left out with a warning, and the showcase and its children still load", async () => {
    const loaded = await loadFromSource({
      load: async () => [
        { ...data("parent", yaml("Parent"), []), themeYaml: parentTheme },
        { ...data("child", yaml("Child"), []), themeYaml: "extends: parent\n" },
      ],
    });
    const byId = new Map(loaded.map((showcase) => [showcase.id, showcase]));
    for (const id of ["parent", "child"]) {
      const theme = byId.get(id)?.theme;
      expect(theme?.vars["primary"]).toBe("#34e7d6");
      expect(theme?.vars).not.toHaveProperty("gradient-accent");
      const messages = showcaseWarnings
        .filter((warning) => warning.showcaseId === id)
        .map(({ message }) => message);
      expect(messages).toEqual([
        expect.stringContaining("showcases/parent/theme.yaml looks cut off"),
      ]);
    }
  });
});

describe("library order", () => {
  const yaml = (title: string) => `
meta:
  title: ${title}
scenes:
  - id: one
    title: One
`;

  it("puts the most recently modified showcase.yaml first, then sorts by title", async () => {
    const loaded = await loadFromSource({
      load: async () => [
        { ...data("old", yaml("Alpha"), []), modifiedMs: 1_000 },
        { ...data("new", yaml("Zulu"), []), modifiedMs: 3_000 },
        { ...data("tie-b", yaml("Bravo"), []), modifiedMs: 2_000 },
        { ...data("tie-a", yaml("Able"), []), modifiedMs: 2_000 },
        data("undated", yaml("Aardvark"), []),
      ],
    });
    expect(loaded.map((showcase) => showcase.id)).toEqual([
      "new",
      "tie-a",
      "tie-b",
      "old",
      "undated",
    ]);
  });
});
