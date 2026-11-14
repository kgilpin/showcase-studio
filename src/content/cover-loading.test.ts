import { beforeAll, describe, expect, it } from "vitest";
import {
  coverFor,
  loadFromSource,
  showcaseErrors,
  showcasesReady,
  showcaseWarnings,
} from "./showcases";
import type { ShowcaseAsset } from "./source";

/* cover.yaml through the loader: a showcase's cover image. Never a
 * reason the showcase won't load — what doesn't read is a warning, and
 * the rest still shows. */

const YAML = `meta:
  title: Covered
  description: d
scenes:
  - id: intro
    theme: statement
    title: Hi
    captions: [{ text: Hello }]
`;

async function loadWith(coverYaml: string | undefined, files: string[] = []) {
  const assets = new Map<string, ShowcaseAsset>();
  for (const name of files) {
    const asset = { url: `/data/covered/assets/${name}`, file: `covered/assets/${name}` };
    assets.set(name, asset);
    assets.set(name.replace(/\.[^.]+$/, ""), asset);
  }
  const [showcase] = await loadFromSource({
    load: async () => [
      { id: "covered", yaml: YAML, coverYaml, assets, words: new Map(), graphics: new Map() },
    ],
  });
  if (!showcase) throw new Error("did not load");
  return showcase;
}

const showcaseLevel = () =>
  showcaseWarnings
    .filter((w) => w.showcaseId === "covered" && w.sceneId === "")
    .map(({ message }) => message);

/* The module loads the bundled library on import; let that finish so it
 * can't land on top of a test's load. */
beforeAll(() => showcasesReady);

describe("a showcase's cover", () => {
  it("has none until cover.yaml exists", async () => {
    expect(coverFor(await loadWith(undefined))).toBeUndefined();
  });

  it("resolves a destination's cover, with the picture's URL", async () => {
    const showcase = await loadWith("picture: shot\nheadline: Hi\ninstagram:\n  layout: band\n", [
      "shot.png",
    ]);
    expect(coverFor(showcase, "instagram")).toMatchObject({
      layout: "band",
      headline: "Hi",
      pictureUrl: "/data/covered/assets/shot.png",
      overridden: ["layout"],
    });
    expect(showcaseLevel()).toEqual([]);
  });

  it("loads the showcase when cover.yaml doesn't read, and says so", async () => {
    const showcase = await loadWith("headline: [unclosed\n");
    expect(showcase.scenes).toHaveLength(1);
    expect(showcaseErrors.map((e) => e.id)).not.toContain("covered");
    expect(coverFor(showcase)).toBeUndefined();
    expect(showcaseLevel()[0]).toMatch(
      /^showcases\/covered\/cover\.yaml doesn't read as YAML, so the showcase shows without its cover/,
    );
  });

  it("leaves out a bad field and a missing picture with a warning each", async () => {
    const showcase = await loadWith("layout: poster\npicture: gone\nheadline: Hi\n");
    expect(coverFor(showcase)).toMatchObject({ layout: "fade", headline: "Hi" });
    expect(showcaseLevel()).toEqual([
      'showcases/covered/cover.yaml: layout must be one of fade, band, split (not "poster") — it is left out',
      'showcases/covered/cover.yaml: no asset named "gone" in assets/ — the cover shows a stand-in',
    ]);
  });
});
