import { beforeAll, describe, expect, it } from "vitest";
import {
  getShowcase,
  isOutline,
  loadFromSource,
  refreshShowcase,
  showcaseErrors,
  showcaseYamlText,
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

/* meta.view: the player view a showcase opens in. One of the player's
 * three names, or a warning and the built-in default. */
describe("the view a showcase opens in", () => {
  const yaml = (view: string) => `
meta:
  title: Explainer
  description: Made for the 4:3 embed
  view: ${view}
scenes:
  - id: one
    theme: statement
    captions:
      - text: Hello.
`;

  it("is read from meta.view", async () => {
    const showcase = await load("view-embed", yaml("embed"));
    expect(showcase.view).toBe("embed");
    expect(warningsFor("")).toEqual([]);
  });

  it("warns on a name the player doesn't have, and leaves it unset", async () => {
    const showcase = await load("view-number", yaml("43"));
    expect(showcase.view).toBeUndefined();
    expect(warningsFor("")).toEqual([
      'view must be one of tiktok, screens, embed — ignoring "43" (the player opens in TikTok view)',
    ]);
  });
});

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

/* A broken theme never fails its showcase: what breaks a rule is left
 * out with a warning, and the showcase shows with the rest. */
describe("a broken theme", () => {
  const yaml = (title: string, meta = "") => `
meta:
  title: ${title}
  description: A themed showcase.${meta}
scenes:
  - id: one
    theme: statement
    title: Hello
`;
  const loadThemes = async (...entries: [string, string | undefined, string?][]) => {
    const loaded = await loadFromSource({
      load: async () =>
        entries.map(([id, themeYaml, meta]) => ({
          ...data(id, yaml(id, meta), []),
          ...(themeYaml == null ? {} : { themeYaml }),
        })),
    });
    const byId = new Map(loaded.map((showcase) => [showcase.id, showcase]));
    const messages = (id: string) =>
      showcaseWarnings.filter((w) => w.showcaseId === id).map(({ message }) => message);
    return { byId, messages };
  };

  it("leaves out an unknown key, an unknown section and a value of the wrong kind", async () => {
    const { byId, messages } = await loadThemes([
      "demo",
      'colors:\n  primary: "#4ade80"\n  glow: red\nlayout:\n  gap: 2\nfonts:\n  load: a.css\n',
    ]);
    expect(showcaseErrors).toEqual([]);
    expect(byId.get("demo")?.theme.vars["primary"]).toBe("#4ade80");
    expect(byId.get("demo")?.theme.fontLoads).toEqual([]);
    expect(messages("demo")).toEqual([
      expect.stringMatching(/^Unknown colors key "glow" .* — it is left out$/),
      expect.stringMatching(/^Unknown section "layout" .* — it is left out$/),
      expect.stringMatching(/^"fonts.load" .* must be a list .* — it is left out$/),
    ]);
  });

  it("shows the showcase without its theme when theme.yaml doesn't parse", async () => {
    const { byId, messages } = await loadThemes(["demo", "colors: [unclosed\n"]);
    expect(showcaseErrors).toEqual([]);
    expect(byId.get("demo")?.theme.vars).toEqual({});
    expect(messages("demo")).toEqual([
      expect.stringContaining("theme.yaml doesn't read as YAML, so the showcase shows without"),
    ]);
  });

  it("starts from the defaults when extends names no showcase, or makes a cycle", async () => {
    const { byId, messages } = await loadThemes(
      ["lonely", 'extends: ghost\ncolors:\n  primary: "#111111"\n'],
      ["a", 'extends: b\ncolors:\n  primary: "#aaaaaa"\n'],
      ["b", 'extends: a\ncolors:\n  accent: "#bbbbbb"\n'],
    );
    expect(showcaseErrors).toEqual([]);
    expect(byId.get("lonely")?.theme.vars).toEqual({ primary: "#111111" });
    expect(messages("lonely")).toEqual([
      expect.stringContaining('extends unknown showcase "ghost"'),
    ]);
    expect(byId.size).toBe(3);
    expect(messages("a").join("\n")).toContain('Theme "extends" cycle: a -> b -> a');
  });

  it("leaves out a meta.theme name that isn't themeable, with the schema's warning", async () => {
    const { byId, messages } = await loadThemes([
      "demo",
      undefined,
      '\n  theme:\n    primary: "#123456"\n    glow: red',
    ]);
    expect(showcaseErrors).toEqual([]);
    expect(byId.get("demo")?.theme.vars).toEqual({ primary: "#123456" });
    expect(messages("demo")).toEqual([expect.stringContaining("glow")]);
  });
});

/* The length limits: meta.sceneMaxMs, a scene's own maxMs, and
 * meta.targetMs. They only warn — the timing is unchanged. */
/* An outline: a showcase.yaml with titles, eyebrows and notes but no
 * captions or media yet, written for the user to review before anything
 * is built. It must load without a warning, so a session isn't pushed to
 * fill in pictures and captions before the user has said yes. */
describe("an outline", () => {
  const outline = `
meta:
  title: Outline
  description: Waiting for review
  sceneMaxMs: 8000
  targetMs: 60000
  notes: |
    What exists already: a CLI that records one test at a time.
    What is new: recording a whole test suite in one run.
    The example all the way through: the checkout tests.
scenes:
  - id: open
    theme: statement
    eyebrow: Background
    title: Record a whole test suite
    note: The problem, before the feature.
  - id: run
    theme: console
    title: One command records every test
    note: The command and what it prints.
  - id: result
    theme: feature
    title: Every test in the list
    note: The list of recordings on the phone.
`;

  it("loads with no warnings", async () => {
    const showcase = await load("outline", outline);
    expect(showcase.scenes.map((scene) => scene.id)).toEqual(["open", "run", "result"]);
    expect(showcaseWarnings.filter((warning) => warning.showcaseId === "outline")).toEqual([]);
  });

  it("is an outline until a scene has captions or media", async () => {
    expect(isOutline((await load("outline", outline)).scenes)).toBe(true);
    const captioned = outline.replace(
      "    note: The problem, before the feature.\n",
      "    note: The problem, before the feature.\n    captions:\n      - text: Hello.\n",
    );
    expect(isOutline((await load("outline", captioned)).scenes)).toBe(false);
    const pictured = outline.replace(
      "    note: The list of recordings on the phone.\n",
      "    note: The list of recordings on the phone.\n    media:\n      kind: image\n      asset: list\n      alt: The list\n",
    );
    expect(isOutline((await load("outline", pictured, ["list.png"])).scenes)).toBe(false);
  });

  it("is not an outline with no scenes", () => {
    expect(isOutline([])).toBe(false);
  });
});

describe("scene and showcase length", () => {
  const yaml = `
meta:
  title: Long
  description: Runs long
  sceneMaxMs: 4000
  targetMs: 10000
scenes:
  - id: short
    theme: statement
    captions:
      - text: Hello.
  - id: pinned
    theme: footage
    durationMs: 9000
    captions:
      - text: A pinned clip.
    media:
      kind: video
      asset: clip
      alt: A clip
      speed: 2
  - id: allowed
    theme: statement
    maxMs: 12000
    durationMs: 9000
    captions:
      - text: Allowed to run long.
`;

  it("warns about each scene over its maximum, with why, and marks it", async () => {
    const showcase = await load("length", yaml, ["clip.mp4"]);
    const [short, pinned, allowed] = showcase.scenes;
    expect(short!.durationMs).toBe(3500);
    expect(short!.maxMs).toBe(4000);
    expect(short!.overMs).toBeUndefined();
    expect(warningsFor("short")).toEqual([]);
    expect(pinned!.overMs).toBe(5000);
    expect(warningsFor("pinned")).toEqual([
      "9 s long, 5 s over the 4 s maximum: pinned by durationMs (a video clip: media.speed " +
        "plays it faster); 1 caption, 3 words",
    ]);
    /* The scene's own maxMs wins over the showcase's. */
    expect(allowed!.maxMs).toBe(12000);
    expect(allowed!.overMs).toBeUndefined();
    expect(warningsFor("allowed")).toEqual([]);
  });

  it("warns once about the showcase over its target, naming the longest scenes", async () => {
    const showcase = await load("length-target", yaml, ["clip.mp4"]);
    expect(showcase.targetMs).toBe(10000);
    expect(warningsFor("")).toEqual([
      "runs 21.5 s, 11.5 s over the 10 s target — longest: pinned (9 s), allowed (9 s), short (3.5 s)",
    ]);
  });

  it("reads a clip's speed, and drops one that is out of range or on an image", async () => {
    const showcase = await load("length-speed", yaml, ["clip.mp4"]);
    const media = showcase.scenes[1]!.media;
    expect(media.kind === "video" && media.speed).toBe(2);

    const bad = await load(
      "length-bad-speed",
      yaml.replace("speed: 2", "speed: 9").replace("maxMs: 12000", "maxMs: soon"),
      ["clip.mp4"],
    );
    const badMedia = bad.scenes[1]!.media;
    expect(badMedia.kind === "video" && badMedia.speed).toBeUndefined();
    expect(warningsFor("pinned")[0]).toBe(
      "media.speed must be between 0.25 and 4 — playing the clip at 1",
    );
    expect(warningsFor("allowed")[0]).toBe(
      'maxMs must be a positive number of milliseconds — ignoring "soon"',
    );
  });

  it("ignores a limit that isn't a number, with a warning, and warns about speed on an image", async () => {
    const image = `
meta:
  title: Still
  description: An image with a speed
  sceneMaxMs: fast
scenes:
  - id: one
    theme: feature
    captions:
      - text: Hello.
    media:
      kind: image
      asset: shot
      alt: A shot
      speed: 2
`;
    const showcase = await load("length-image", image, ["shot.png"]);
    expect(showcase.scenes[0]!.maxMs).toBeUndefined();
    expect(warningsFor("")).toEqual([
      'meta.sceneMaxMs must be a positive number of milliseconds — ignoring "fast"',
    ]);
    expect(warningsFor("one")).toEqual([
      "media.speed only applies to a video — remove it from this image",
    ]);
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

describe("the schema check", () => {
  it("warns about a field in the wrong place, on the scene it is in", async () => {
    await load(
      "misplaced",
      `meta:
  title: Misplaced
  description: d
  loop: false
scenes:
  - id: one
    theme: footage
    media: { kind: video, asset: clip, alt: a }
    captions: [{ text: Hi }]
  - id: two
    theme: footage
    clip: false
    media: { kind: video, asset: clip, alt: a }
    captions: [{ text: Hi }]
`,
      ["clip.mp4"],
    );
    expect(warningsFor("one")).toEqual([]);
    expect(warningsFor("two")).toEqual([
      'scenes[1]: "clip" isn\'t a scene field — it belongs in scenes[].take (scenes[].take.clip)',
    ]);
  });

  it("warns about a bad say entry, whatever its word is, and still loads", async () => {
    /* "theme", "speed" and "tiktok" are also fields other readers check. */
    const showcase = await load(
      "said",
      `meta:
  title: Said
  description: d
  loop: false
  voiceover:
    say: { theme: 4, speed: { sound: x }, tiktok: [tick, tock], GitHub: Git Hub }
scenes:
  - id: one
    theme: statement
    captions: [{ text: Hi }]
`,
    );
    expect(showcase).toBeDefined();
    const said = warningsFor("").join("\n");
    for (const word of ["theme", "speed", "tiktok"]) {
      expect(said).toContain(`meta.voiceover.say.${word}`);
    }
    expect(said).not.toContain("say.GitHub");
  });

  it("leaves a field's value to the reader that owns it, so a mistake is said once", async () => {
    await load(
      "once",
      `meta:
  title: Once
  description: d
  loop: false
  view: sideways
scenes:
  - id: one
    theme: feature
    media: { kind: image, asset: shot, alt: a, tiktok: { fit: sideways, bogus: 1 } }
    captions: [{ text: Hi, position: high }]
`,
      ["shot.png"],
    );
    const sceneWarnings = warningsFor("one");
    expect(sceneWarnings.filter((message) => message.includes("sideways"))).toHaveLength(1);
    expect(sceneWarnings.filter((message) => message.includes("bogus"))).toHaveLength(1);
    expect(sceneWarnings.filter((message) => message.includes("high"))).toHaveLength(1);
    expect(warningsFor("").filter((message) => message.includes("sideways"))).toHaveLength(1);
  });
});

/* refreshShowcase: a showcase whose files changed on disk is re-read
 * from the source and rebuilt in place (src/lib/live-updates.ts drives
 * it from the studio's "showcase-changed" event). */
describe("re-reading a showcase changed on disk", () => {
  const yaml = (durationMs: number) => `
meta:
  title: Live
  description: A voiced draft
  soundtrack: { src: voiceover, volume: 1, sync: true }
scenes:
  - id: one
    theme: statement
    durationMs: ${durationMs}
    captions:
      - text: Hello.
`;
  const source = (entries: Map<string, ShowcaseData>) => ({
    load: async () => [...entries.values()],
    loadOne: async (id: string) => entries.get(id) ?? null,
  });
  const withVersion = (entry: ShowcaseData, v: number): ShowcaseData => ({
    ...entry,
    assets: new Map([...entry.assets].map(([key, a]) => [key, { ...a, url: `${a.url}?v=${v}` }])),
  });

  it("swaps in the new durations and media URLs — the build's output — in place", async () => {
    const entries = new Map([["live", data("live", yaml(1000), ["voiceover.m4a"])]]);
    const [before] = await loadFromSource(source(entries));
    expect(before?.scenes[0]?.durationMs).toBe(1000);
    /* The voiceover built again: new pins, the same file under a new URL. */
    entries.set("live", withVersion(data("live", yaml(2500), ["voiceover.m4a"]), 2));
    expect(await refreshShowcase("live")).toBe("updated");
    const after = getShowcase("live");
    expect(after?.scenes[0]?.durationMs).toBe(2500);
    expect(after?.soundtrack?.src).toBe("/data/live/assets/voiceover.m4a?v=2");
    /* The next in-app edit is made against the text just read. */
    expect(showcaseYamlText("live")).toBe(yaml(2500));
  });

  it("reports the same files as unchanged", async () => {
    const entries = new Map([["live", data("live", yaml(1000), ["voiceover.m4a"])]]);
    await loadFromSource(source(entries));
    entries.set("live", data("live", yaml(1000), ["voiceover.m4a"]));
    expect(await refreshShowcase("live")).toBe("unchanged");
  });

  it("keeps the last good version when the new showcase.yaml doesn't parse", async () => {
    const entries = new Map([["live", data("live", yaml(1000), ["voiceover.m4a"])]]);
    await loadFromSource(source(entries));
    entries.set("live", data("live", "meta: [unclosed", ["voiceover.m4a"]));
    expect(await refreshShowcase("live")).toBe("unchanged");
    expect(getShowcase("live")?.scenes[0]?.durationMs).toBe(1000);
    expect(showcaseErrors.map((e) => e.id)).toContain("live");
    /* And forgets the error once the file reads again. */
    entries.set("live", data("live", yaml(1200), ["voiceover.m4a"]));
    expect(await refreshShowcase("live")).toBe("updated");
    expect(showcaseErrors.map((e) => e.id)).not.toContain("live");
  });

  it("says when the library gained or lost a showcase, or never had it", async () => {
    const entries = new Map([["live", data("live", yaml(1000), [])]]);
    await loadFromSource(source(entries));
    entries.set("newcomer", data("newcomer", yaml(1000), []));
    expect(await refreshShowcase("newcomer")).toBe("added");
    entries.delete("live");
    expect(await refreshShowcase("live")).toBe("removed");
    expect(await refreshShowcase("nobody")).toBe("ignored");
  });

  it("is unsupported for a source that can't re-read one showcase", async () => {
    await loadFromSource({ load: async () => [data("live", yaml(1000), [])] });
    expect(await refreshShowcase("live")).toBe("unsupported");
  });
});
