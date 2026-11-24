/* The synthesized voiceover, end to end, with a stand-in for Polly and
 * for whisper — no AWS, no network, no speech model.
 *
 * The stand-in Polly makes a clip with the bundled ffmpeg: 100 ms of
 * silence, a tone whose length follows the caption's length, then 100 ms
 * of silence. The quiet edges are what the words fitting has to see past,
 * as it does with Polly's real clips. The stand-in whisper hears one word
 * per caption word, evenly spread, and joins "type/showcase" into one
 * token the way the real one does. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { resolveSceneTiming } from "../src/content/timing.mjs";
import { mediaDuration, runFfmpeg } from "./ffmpeg.mjs";
import { readSay, sayCaption } from "./voiceover-say.mjs";
import {
  DEFAULT_REGION,
  buildVoiceover,
  captionKey,
  captionSegment,
  captionWords,
  hasVoiceover,
  layOutWindows,
  migrateLibraryVoiceovers,
  migrateVoiceoverYaml,
  pollyArgs,
  readVoiceoverPlan,
  resolveAws,
  splitHeardWords,
  voicedSpan,
  voiceoverStatus,
} from "./voiceover.mjs";

/** The aws command's configuration, as a machine with a default profile
 *  and a region would answer — the showcase names neither. */
const AWS = {
  profiles: () => ["default", "work"],
  regionOf: (profile) => (profile === "work" ? "eu-west-1" : "us-west-2"),
};
/** This Mac: named profiles only, one of them with no region. */
const NO_DEFAULT = {
  profiles: () => ["personal", "work"],
  regionOf: (profile) => (profile === "work" ? "eu-west-1" : undefined),
};
const NO_ENV = {};

const toneSeconds = (text) => 0.4 + text.length * 0.02;

function fakePolly(calls = []) {
  return async ({ text, ssml, voice, engine, out }) => {
    calls.push({ text, voice, engine, ...(ssml ? { ssml } : {}) });
    await runFfmpeg([
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=f=440:r=24000:d=${toneSeconds(text).toFixed(3)}`,
      "-af",
      "adelay=100,apad=pad_dur=0.1",
      "-ac",
      "1",
      "-c:a",
      "libmp3lame",
      "-f",
      "mp3",
      out,
    ]);
  };
}

/** Hears the caption that made the clip: evenly spread words over the
 *  tone, with "Type /showcase" joined the way whisper joins it. */
function fakeWhisper(textOf) {
  return async (file) => {
    const sent = textOf(file);
    /* SSML is heard without its tags. */
    const text = sent
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<");
    const heard = text
      .replace(/Type \/showcase/g, "type/showcase")
      .split(/\s+/)
      .filter(Boolean);
    const span = toneSeconds(sent) * 1000;
    const step = span / heard.length;
    return {
      segments: [
        {
          words: heard.map((word, i) => ({
            text: ` ${word}`,
            startMs: Math.round(100 + i * step),
            endMs: Math.round(100 + (i + 1) * step - 10),
          })),
        },
      ],
    };
  };
}

const SHOWCASE = `# A voiced showcase
meta:
  title: Voiced
  voiceover: { polly: { voice: Matthew, engine: generative }, track: voiceover-synth }

scenes:
  - id: open
    theme: statement
    captions:
      # the opening line
      - text: I made this video with Showcase Studio.
  - id: plugin
    theme: console
    captions:
      - text: Type /showcase, and the studio opens.
      - text: Export in "shorts" format.
  - id: card
    theme: statement
    durationMs: 2000
  - id: outro
    theme: statement
    captions:
      - text: Make your first video today.
`;

let library;
let calls;
/** clip file → the caption text the stand-in Polly read into it. */
let spoken;

const yamlOf = () => readFileSync(path.join(library, "voiced", "showcase.yaml"), "utf8");
const docOf = () => parse(yamlOf());
const captionPins = (doc) =>
  doc.scenes.flatMap((scene) => (scene.captions ?? []).map((caption) => caption.durationMs));

function build(options = {}) {
  const synth = fakePolly(calls);
  return buildVoiceover({
    showcasesDir: library,
    showcaseId: "voiced",
    synthesize: async (args) => {
      await synth(args);
      spoken.set(args.out.replace(/\.partial$/, ""), args.text);
      calls[calls.length - 1].profile = args.profile;
      calls[calls.length - 1].region = args.region;
    },
    transcribe: fakeWhisper((file) => spoken.get(file)),
    aws: AWS,
    env: NO_ENV,
    ...options,
  });
}

beforeEach(async () => {
  library = await mkdtemp(path.join(os.tmpdir(), "studio-voiceover-"));
  mkdirSync(path.join(library, "voiced"));
  writeFileSync(path.join(library, "voiced", "showcase.yaml"), SHOWCASE);
  calls = [];
  spoken = new Map();
});

afterEach(async () => {
  await rm(library, { recursive: true, force: true });
});

describe("buildVoiceover", () => {
  it("voices every caption and pins each one to its window", async () => {
    const result = await build();
    expect(result).toMatchObject({ ok: true, synthesized: 4, reused: 0 });
    expect(calls.map((c) => c.text)).toEqual([
      "I made this video with Showcase Studio.",
      "Type /showcase, and the studio opens.",
      'Export in "shorts" format.',
      "Make your first video today.",
    ]);
    const pins = captionPins(docOf());
    /* lead + spoken + tail, the last one holding 1.5 s more */
    for (const [i, pin] of pins.entries()) {
      const spokenMs = pin - 250 - 450 - (i === pins.length - 1 ? 1500 : 0);
      expect(spokenMs).toBeGreaterThan(toneSeconds(calls[i].text) * 1000);
      expect(spokenMs).toBeLessThan(toneSeconds(calls[i].text) * 1000 + 300);
    }
    expect(result.totalMs).toBe(pins.reduce((a, b) => a + b, 0) + 2000);
  });

  it("makes a track as long as the pins add up to", async () => {
    const result = await build();
    const seconds = await mediaDuration(
      path.join(library, "voiced", "assets", "voiceover-synth.m4a"),
    );
    /* AAC rounds the end up to its next frame, 1024 samples. */
    expect(seconds * 1000).toBeGreaterThanOrEqual(result.totalMs - 1);
    expect(seconds * 1000).toBeLessThan(result.totalMs + 50);
  });

  it("keeps the file's comments, and points meta.soundtrack at the track", async () => {
    await build();
    expect(yamlOf()).toContain("# the opening line");
    expect(docOf().meta.soundtrack).toEqual({ src: "voiceover-synth", volume: 1, sync: true });
  });

  it("leaves a scene with no captions as silence for as long as it shows", async () => {
    const result = await build();
    const doc = docOf();
    expect(doc.scenes[2].durationMs).toBe(2000);
    const [open, plugin] = [doc.scenes[0], doc.scenes[1]];
    const words = JSON.parse(
      readFileSync(path.join(library, "voiced", "assets", "voiceover-synth.words.json"), "utf8"),
    );
    const outro = words.segments.at(-1);
    const before =
      open.captions[0].durationMs + plugin.captions[0].durationMs + plugin.captions[1].durationMs;
    expect(outro.startMs).toBe(before + 2000);
    expect(outro.endMs).toBe(result.totalMs);
  });

  it("pins a scene the player would otherwise stretch to the floor for short slides", async () => {
    await build();
    const open = docOf().scenes[0];
    /* One short caption: its window is under the 3.5 s floor, so the
     * scene is pinned to the window rather than held longer. */
    expect(open.captions[0].durationMs).toBeLessThan(3500);
    expect(open.durationMs).toBe(open.captions[0].durationMs);
    /* Two captions already add up past the floor: no scene pin. */
    expect(docOf().scenes[1].durationMs).toBeUndefined();
  });

  it("writes one words segment per caption, in the caption's own words", async () => {
    const result = await build();
    /* every caption's heard words were fitted, none estimated */
    expect(result.notes).toEqual([]);
    const { segments } = JSON.parse(
      readFileSync(path.join(library, "voiced", "assets", "voiceover-synth.words.json"), "utf8"),
    );
    expect(segments.map((s) => s.words.map((w) => w.text))).toEqual([
      ["I", "made", "this", "video", "with", "Showcase", "Studio"],
      ["Type", "/showcase", "and", "the", "studio", "opens"],
      ["Export", "in", "shorts", "format"],
      ["Make", "your", "first", "video", "today"],
    ]);
    for (const segment of segments) {
      /* inside the voiced part of the window: past the lead and the
       * clip's own 100 ms of quiet */
      expect(segment.words[0].startMs).toBeGreaterThanOrEqual(segment.startMs + 250 + 90);
      expect(segment.words.at(-1).endMs).toBeLessThanOrEqual(segment.endMs - 450);
      /* fitted: the first word starts where the voice does, give or take
       * the mp3's own few ms of padding */
      expect(Math.abs(segment.words[0].startMs - (segment.startMs + 250 + 100))).toBeLessThan(40);
      for (const [i, word] of segment.words.entries()) {
        expect(word.endMs).toBeGreaterThanOrEqual(word.startMs);
        if (i > 0) expect(word.startMs).toBeGreaterThanOrEqual(segment.words[i - 1].startMs);
      }
    }
  });

  it("calls Polly again only for the caption that changed", async () => {
    await build();
    const before = captionPins(docOf());
    writeFileSync(
      path.join(library, "voiced", "showcase.yaml"),
      yamlOf().replace("Make your first video today.", "Make your very first video today, now."),
    );
    calls = [];
    const result = await build();
    expect(result).toMatchObject({ ok: true, synthesized: 1, reused: 3 });
    expect(calls.map((c) => c.text)).toEqual(["Make your very first video today, now."]);
    const after = captionPins(docOf());
    expect(after.slice(0, 3)).toEqual(before.slice(0, 3));
    expect(after[3]).toBeGreaterThan(before[3]);
    /* the old clip is gone from the cache */
    const cache = path.join(library, ".studio", "build", "voiceover", "voiced");
    expect(readdirSync(cache).filter((f) => f.endsWith(".mp3"))).toHaveLength(4);
  });

  it("leaves everything alone when nothing changed", async () => {
    await build();
    const result = await build();
    expect(result).toMatchObject({
      ok: true,
      synthesized: 0,
      built: [],
      unchanged: ["voiceover-synth.m4a", "voiceover-synth.words.json"],
    });
  });

  it("makes every clip again when forced", async () => {
    await build();
    calls = [];
    const result = await build({ force: true });
    expect(result.synthesized).toBe(4);
    expect(result.built).toEqual(["voiceover-synth.m4a", "voiceover-synth.words.json"]);
  });

  it("estimates the word times, and says so, without whisper", async () => {
    const result = await build({
      transcribe: async () => {
        throw new Error("No whisper binary found");
      },
    });
    expect(result.ok).toBe(true);
    expect(result.notes.join("\n")).toMatch(/estimates.*No whisper binary found/);
    const { segments } = JSON.parse(
      readFileSync(path.join(library, "voiced", "assets", "voiceover-synth.words.json"), "utf8"),
    );
    expect(segments[0].words).toHaveLength(7);
    /* and hears them next time, rather than keeping the estimate */
    const again = await build();
    expect(again.built).toEqual(["voiceover-synth.words.json"]);
    expect(again.notes).toEqual([]);
  });

  it("refuses to pin captions that changed while it was talking", async () => {
    const synth = fakePolly();
    const result = await buildVoiceover({
      showcasesDir: library,
      showcaseId: "voiced",
      transcribe: null,
      aws: AWS,
      env: NO_ENV,
      synthesize: async (args) => {
        await synth(args);
        if (args.text.startsWith("Make")) {
          writeFileSync(
            path.join(library, "voiced", "showcase.yaml"),
            yamlOf().replace("Make your first", "Make our first"),
          );
        }
      },
    });
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/changed while/);
    expect(captionPins(docOf()).every((pin) => pin == null)).toBe(true);
  });

  /* Some scenes read, the rest left alone (issue #48). */
  it("reads only the scenes meta.voiceover.scenes names, and leaves the others their own timing", async () => {
    const yaml = SHOWCASE.replace(
      "track: voiceover-synth }",
      "track: voiceover-synth, scenes: [plugin] }",
    );
    writeFileSync(path.join(library, "voiced", "showcase.yaml"), yaml);
    const before = voiceoverStatus({
      showcasesDir: library,
      showcaseId: "voiced",
      aws: AWS,
      env: NO_ENV,
    });
    expect(before.stale[0]).toBe("2 captions to voice");

    const result = await build();
    expect(result).toMatchObject({ ok: true, synthesized: 2, reused: 0 });
    expect(calls.map((c) => c.text)).toEqual([
      "Type /showcase, and the studio opens.",
      'Export in "shorts" format.',
    ]);
    const doc = docOf();
    const [open, plugin, card, outro] = doc.scenes;
    /* The scenes the voice doesn't read: no pins written, theirs to time. */
    expect(open.captions[0].durationMs).toBeUndefined();
    expect(open.durationMs).toBeUndefined();
    expect(outro.captions[0].durationMs).toBeUndefined();
    expect(card.durationMs).toBe(2000);
    expect(plugin.captions.map((c) => c.durationMs).every((ms) => ms > 0)).toBe(true);
    /* On the track they are silence for as long as the player shows
     * them, so the plugin's words start after the open scene's time and
     * the track ends after the outro's. */
    const openMs = resolveSceneTiming(open).durationMs;
    const outroMs = resolveSceneTiming(outro).durationMs;
    const pluginMs = plugin.captions[0].durationMs + plugin.captions[1].durationMs;
    expect(result.totalMs).toBe(openMs + pluginMs + 2000 + outroMs);
    const words = JSON.parse(
      readFileSync(path.join(library, "voiced", "assets", "voiceover-synth.words.json"), "utf8"),
    );
    expect(words.segments).toHaveLength(2);
    expect(words.segments[0].startMs).toBe(openMs);
    expect(words.segments[1].endMs).toBe(openMs + pluginMs);
    expect(
      voiceoverStatus({ showcasesDir: library, showcaseId: "voiced", aws: AWS, env: NO_ENV }),
    ).toMatchObject({ upToDate: true });
    /* The whole list is in the print: reading another scene is a rebuild. */
    writeFileSync(
      path.join(library, "voiced", "showcase.yaml"),
      yamlOf().replace("scenes: [ plugin ]", "scenes: [ plugin, outro ]"),
    );
    const after = voiceoverStatus({
      showcasesDir: library,
      showcaseId: "voiced",
      aws: AWS,
      env: NO_ENV,
    });
    expect(after.upToDate).toBe(false);
    expect(after.stale).toContain("outro caption 1 (to voice)");
  });

  it("writes the scenes `only` names into the showcase, so the next build keeps to them", async () => {
    const result = await build({ only: ["outro"] });
    expect(result).toMatchObject({ ok: true, synthesized: 1 });
    expect(calls.map((c) => c.text)).toEqual(["Make your first video today."]);
    expect(docOf().meta.voiceover).toEqual({
      polly: { voice: "Matthew", engine: "generative" },
      track: "voiceover-synth",
      scenes: ["outro"],
    });
    expect(yamlOf()).toContain("# the opening line");
    expect(docOf().scenes[0].captions[0].durationMs).toBeUndefined();
    /* A plain build afterwards — the automatic one — reads the same scene
     * and no other, and has nothing to do. */
    const again = await build();
    expect(again).toMatchObject({ ok: true, synthesized: 0, built: [] });
    expect(calls).toHaveLength(1);
  });

  it("says what to do on a showcase with no meta.voiceover", async () => {
    writeFileSync(
      path.join(library, "voiced", "showcase.yaml"),
      "meta: {title: X}\nscenes: [{id: a, captions: [{text: Hi}]}]\n",
    );
    const result = await build();
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toContain("meta.voiceover");
    expect(calls).toEqual([]);
    expect(existsSync(path.join(library, "voiced", "assets", "voiceover-synth.m4a"))).toBe(false);
  });

  it("refuses a showcase that is also cut from a recording", async () => {
    writeFileSync(
      path.join(library, "voiced", "showcase.yaml"),
      "meta: {title: X, voiceover: {}, source: {video: a.mov}}\nscenes: [{id: a, captions: [{text: Hi}]}]\n",
    );
    const result = await build();
    expect(result.error).toMatch(/not both/);
  });
});

/* Which AWS profile and region the voice is made with (resolveAws): the
 * showcase, else the library's showcase_settings.yaml, else the
 * environment, else the aws command's default profile — checked against
 * the profiles the machine has before the first Polly call, so a missing
 * profile is a question for the user rather than a failed build. */
describe("the AWS setup", () => {
  /* The Polly block's settings, given as they go in it. */
  const settingsOf = (polly = {}) =>
    readVoiceoverPlan({
      meta: { voiceover: { polly } },
      scenes: [{ id: "a", captions: [{ text: "Hi" }] }],
    }).settings;
  const resolve = (voiceover, { aws = AWS, env = NO_ENV } = {}) =>
    resolveAws({ settings: settingsOf(voiceover), showcasesDir: library, aws, env });
  const librarySettings = (text) =>
    writeFileSync(path.join(library, "showcase_settings.yaml"), text);

  it("uses the default profile and its region when nothing names one", () => {
    expect(resolve({})).toEqual({
      ok: true,
      profile: undefined,
      region: "us-west-2",
      note: undefined,
    });
    expect(resolve({ profile: "work" })).toMatchObject({ profile: "work", region: "eu-west-1" });
    expect(resolve({ profile: "work", region: "ap-south-1" })).toMatchObject({
      region: "ap-south-1",
    });
  });

  it("asks for a profile, naming the machine's, when there is no default one", () => {
    const result = resolve({}, { aws: NO_DEFAULT });
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(
      /^No AWS profile for Polly: this machine has no default profile/,
    );
    expect(result.problem).toContain("profiles: personal, work.");
    expect(result.problem).toContain("Ask the user which one");
    expect(result.problem).toContain("aws_profile in showcase_settings.yaml");
    /* The showcase's own, the library's, or the environment's profile
     * settles it. */
    expect(resolve({ profile: "work" }, { aws: NO_DEFAULT })).toMatchObject({ ok: true });
    librarySettings("aws_profile: personal\n");
    expect(resolve({}, { aws: NO_DEFAULT })).toMatchObject({ ok: true, profile: "personal" });
    librarySettings("");
    expect(resolve({}, { aws: NO_DEFAULT, env: { AWS_PROFILE: "work" } })).toMatchObject({
      ok: true,
      profile: "work",
      region: "eu-west-1",
    });
  });

  it("refuses a profile the machine doesn't have, saying where it came from", () => {
    expect(resolve({ profile: "nobody" }).problem).toBe(
      'No AWS profile named "nobody" on this machine (meta.voiceover.polly.profile). ' +
        "This machine's profiles: default, work.",
    );
    librarySettings("aws_profile: nobody\n");
    expect(resolve({}).problem).toContain("(aws_profile in showcase_settings.yaml)");
    librarySettings("");
    expect(resolve({}, { env: { AWS_PROFILE: "nobody" } }).problem).toContain(
      "(AWS_PROFILE in the environment)",
    );
  });

  it("reads the library's setting with its variables expanded, and reports one that isn't set", () => {
    librarySettings("aws_profile: ${LOGIN}\naws_region: ${PLACE}\n");
    expect(
      resolve({}, { aws: NO_DEFAULT, env: { LOGIN: "personal", PLACE: "ca-central-1" } }),
    ).toEqual({ ok: true, profile: "personal", region: "ca-central-1", note: undefined });
    const result = resolve({}, { aws: NO_DEFAULT, env: { LOGIN: "personal" } });
    expect(result.ok).toBe(false);
    expect(result.problem).toBe(
      "showcase_settings.yaml aws_region: ${PLACE} — PLACE isn't set in the environment",
    );
  });

  it("falls back to a region, and says so, when the profile has none", () => {
    expect(resolve({ profile: "personal" }, { aws: NO_DEFAULT })).toEqual({
      ok: true,
      profile: "personal",
      region: DEFAULT_REGION,
      note: expect.stringMatching(
        /profile "personal" has no region set, so Polly was called in us-east-1/,
      ),
    });
    librarySettings("aws_region: eu-north-1\n");
    expect(resolve({ profile: "personal" }, { aws: NO_DEFAULT })).toMatchObject({
      region: "eu-north-1",
      note: undefined,
    });
    librarySettings("");
    expect(
      resolve(
        { profile: "personal" },
        { aws: NO_DEFAULT, env: { AWS_DEFAULT_REGION: "sa-east-1" } },
      ),
    ).toMatchObject({ region: "sa-east-1" });
  });

  it("says the aws command isn't installed, or has no profiles at all", () => {
    expect(
      resolve({}, { aws: { profiles: () => undefined, regionOf: () => undefined } }).problem,
    ).toMatch(/^The aws command isn't installed/);
    const none = resolve({}, { aws: { profiles: () => [], regionOf: () => undefined } });
    expect(none.problem).toContain("has no profiles yet");
    expect(none.problem).not.toContain("Ask the user");
  });

  it("is what the status reports, before any build, and what the build refuses on", async () => {
    const status = voiceoverStatus({
      showcasesDir: library,
      showcaseId: "voiced",
      aws: NO_DEFAULT,
      env: NO_ENV,
    });
    expect(status).toMatchObject({
      built: true,
      kind: "voiceover",
      ok: false,
      problem: expect.stringMatching(/^No AWS profile for Polly/),
    });
    expect(await build({ aws: NO_DEFAULT })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^No AWS profile for Polly/),
    });
    expect(calls).toHaveLength(0);
  });

  it("hands the resolved profile and region to Polly, and notes a region it chose", async () => {
    librarySettings("aws_profile: ${LOGIN}\n");
    const result = await build({ aws: NO_DEFAULT, env: { LOGIN: "personal" } });
    expect(result).toMatchObject({ ok: true, synthesized: 4 });
    expect(calls[0]).toMatchObject({ profile: "personal", region: DEFAULT_REGION });
    expect(result.notes.filter((note) => note.includes("no region set"))).toHaveLength(1);
    /* Nothing to voice again: no Polly call, and no note about it. */
    expect((await build({ aws: NO_DEFAULT, env: { LOGIN: "personal" } })).notes).toEqual([]);
  });
});

/* How a word is said (issue #83): only what Polly is sent changes. */
describe("the say list", () => {
  const write = ({ say, texts, engine = "generative" }) =>
    writeFileSync(
      path.join(library, "voiced", "showcase.yaml"),
      JSON.stringify({
        meta: { title: "Voiced", voiceover: { polly: { engine }, ...(say ? { say } : {}) } },
        scenes: texts.map((text, i) => ({ id: `s${i}`, captions: [{ text }] })),
      }),
    );
  const librarySettings = (text) =>
    writeFileSync(path.join(library, "showcase_settings.yaml"), text);
  const status = () =>
    voiceoverStatus({ showcasesDir: library, showcaseId: "voiced", aws: AWS, env: NO_ENV });
  const wordsFile = () =>
    JSON.parse(
      readFileSync(path.join(library, "voiced", "assets", "voiceover.words.json"), "utf8"),
    );

  it("sends the respelling to Polly and keeps the caption's own word on screen", async () => {
    write({ say: { GitHub: "Git Hub" }, texts: ["Push it to GitHub today."] });
    const result = await build();
    expect(calls.map((c) => c.text)).toEqual(["Push it to Git Hub today."]);
    expect(calls[0].ssml).toBeUndefined();
    const [segment] = wordsFile().segments;
    expect(segment.text).toBe("Push it to GitHub today.");
    expect(segment.words.map((w) => w.text)).toEqual(["Push", "it", "to", "GitHub", "today"]);
    /* Fitted: "Git" and "Hub" are the one word "GitHub", twice as long as
     * the words said as written. */
    expect(result.notes).toEqual([]);
    const lengths = segment.words.map((w) => w.endMs - w.startMs);
    expect(lengths[3]).toBeGreaterThan(lengths[0] * 1.7);
    expect(docOf().scenes[0].captions[0].text).toBe("Push it to GitHub today.");
  });

  it("sends an ipa entry as SSML, with the rest of the caption escaped", async () => {
    write({
      say: { records: { ipa: "rɪˈkɔːrdz" } },
      texts: ["It records Q&A when x <y today."],
    });
    const result = await build();
    expect(calls[0]).toMatchObject({
      ssml: true,
      text:
        '<speak>It <phoneme alphabet="ipa" ph="rɪˈkɔːrdz">records</phoneme> ' +
        "Q&amp;A when x &lt;y today.</speak>",
    });
    expect(result.notes).toEqual([]);
    const args = pollyArgs({ ...calls[0], out: "clip.mp3" });
    expect(args.slice(-5)).toEqual(["--text-type", "ssml", "--text", calls[0].text, "clip.mp3"]);
    expect(pollyArgs({ text: "Plain.", out: "clip.mp3" })).not.toContain("--text-type");
  });

  it("re-voices only the captions that hold the word whose entry changed", async () => {
    const texts = ["GitHub is here.", "Nothing to change.", "AppMap records it.", "Open GitHub."];
    write({ say: { GitHub: "Git Hub", AppMap: "App Map" }, texts });
    await build();
    calls = [];
    write({ say: { GitHub: "Git Hubb", AppMap: "App Map" }, texts });
    expect(status().stale[0]).toBe("2 captions to voice");
    expect(await build()).toMatchObject({ synthesized: 2, reused: 2 });
    expect(calls.map((c) => c.text)).toEqual(["Git Hubb is here.", "Open Git Hubb."]);
    expect(status()).toMatchObject({ upToDate: true });
  });

  it("never lets the aws command read a file for a respelling", () => {
    for (const path of ["file:///etc/passwd", "fileb://notes.txt"]) {
      const { text } = sayCaption("Hello", [readSay({ Hello: path }, "say").entries]);
      expect(pollyArgs({ text, out: "clip.mp3" }).at(-2)).toBe(` ${path}`);
    }
  });

  it("leaves recordsets alone when the entry is records", async () => {
    write({ say: { records: "re cords" }, texts: ["It records recordsets."] });
    await build();
    expect(calls[0].text).toBe("It re cords recordsets.");
  });

  it("keys a showcase with no list exactly as before there were lists", () => {
    /* Written down from the code before say: a change here throws away
     * every clip people have paid for. */
    const settings = { engine: "generative", voice: "Matthew" };
    expect(captionKey(settings, "GitHub records recordsets.")).toBe(
      "7d79f1a10e20e28f9bbcfce16d821777",
    );
    expect(
      captionKey({ engine: "neural", voice: "Joanna" }, "Type /showcase, now.", { ssml: false }),
    ).toBe("b6a66c97a6f9777c9752c1f567e26a95");
  });

  it("uses the library's list, with the showcase's own entry winning", async () => {
    librarySettings("say:\n  GitHub: Git Hub\n  AppMap: App Map\n");
    write({ say: { AppMap: "Ap Map" }, texts: ["GitHub and AppMap."] });
    await build();
    expect(calls[0].text).toBe("Git Hub and Ap Map.");
  });

  it("is out of date after the library's list changes, and re-voices nothing it doesn't touch", async () => {
    write({ texts: ["Nothing to change."] });
    await build();
    expect(status()).toMatchObject({ upToDate: true });
    librarySettings("say: { GitHub: Git Hub }\n");
    expect(status().stale).toEqual(["voiceover.m4a"]);
    expect(await build()).toMatchObject({ synthesized: 0, built: [] });
    expect(status()).toMatchObject({ upToDate: true });
  });

  it("leaves out an entry that doesn't read, says so, and still builds", async () => {
    librarySettings("say: { AppMap: 12 }\n");
    write({ say: { GitHub: ["Git", "Hub"] }, texts: ["GitHub and AppMap."] });
    const result = await build();
    expect(result.ok).toBe(true);
    expect(calls[0].text).toBe("GitHub and AppMap.");
    expect(result.notes.join("\n")).toMatch(/meta\.voiceover\.say\.GitHub must be/);
    expect(result.notes.join("\n")).toMatch(/showcase_settings\.yaml say\.AppMap must be/);
  });

  it("names the entry and the engine when Polly refuses an ipa", async () => {
    write({ say: { records: { ipa: "rɪ" } }, texts: ["It records."], engine: "neural" });
    const failed = build({
      synthesize: async () => {
        throw new Error("InvalidSsmlException");
      },
    });
    await expect(failed).rejects.toThrow(
      's0 caption 1 uses the say entry "records" (ipa) with the neural engine, ' +
        "and Polly didn't make it: InvalidSsmlException",
    );
  });

  describe("timing a replaced word", () => {
    /** The words captionSegment times, from one heard word every 100 ms. */
    const timed = (text, say, heard) => {
      const words = heard.split(" ");
      const { segment, fitted } = captionSegment(
        {
          text,
          say: sayCaption(text, [readSay(say, "say").entries]),
          startMs: 0,
          durationMs: 5000,
          voiced: { onMs: 0, offMs: words.length * 100 },
          heard: words.map((word, i) => ({ text: word, startMs: i * 100, endMs: (i + 1) * 100 })),
        },
        { leadMs: 0 },
      );
      return { fitted, words: segment.words.map((w) => [w.text, w.startMs, w.endMs]) };
    };
    const two = { GitHub: "Git Hub", AppMap: "App Map" };

    it("takes a respelling heard as two words, or joined back into one", () => {
      expect(timed("Use GitHub now", two, "use git hub now")).toEqual({
        fitted: true,
        words: [
          ["Use", 0, 100],
          ["GitHub", 100, 300],
          ["now", 300, 400],
        ],
      });
      expect(timed("Use GitHub now", two, "use GitHub now").words[1]).toEqual(["GitHub", 100, 200]);
    });

    it("tells which of two replaced words was heard joined", () => {
      expect(timed("GitHub and AppMap", two, "GitHub and app map").words).toEqual([
        ["GitHub", 0, 100],
        ["and", 100, 200],
        ["AppMap", 200, 400],
      ]);
      expect(timed("GitHub AppMap", two, "git hub AppMap").words).toEqual([
        ["GitHub", 0, 200],
        ["AppMap", 200, 300],
      ]);
    });

    it("takes more words than the respelling has when the rest are heard as written", () => {
      expect(timed("Use Nginx now", { Nginx: "enginex" }, "use engine x now")).toEqual({
        fitted: true,
        words: [
          ["Use", 0, 100],
          ["Nginx", 100, 300],
          ["now", 300, 400],
        ],
      });
    });

    it("splits a several-word key said as one over its own words", () => {
      expect(timed("In New York now", { "New York": "Noo-york" }, "in newyork now").words).toEqual([
        ["In", 0, 100],
        ["New", 100, 143],
        ["York", 143, 200],
        ["now", 200, 300],
      ]);
    });

    it("lights no word for a spoken symbol", () => {
      expect(timed("Build & ship", { "&": "and" }, "build and ship").words).toEqual([
        ["Build", 0, 100],
        ["ship", 200, 300],
      ]);
    });

    it("still gives up when the other words don't fit", () => {
      expect(timed("Use GitHub now", two, "something else was said right here").fitted).toBe(false);
      expect(timed("Use GitHub now", two, "use").fitted).toBe(false);
    });
  });
});

describe("hasVoiceover", () => {
  it("is true for a voiced showcase and false for anything else", () => {
    mkdirSync(path.join(library, "cut"));
    writeFileSync(path.join(library, "cut", "showcase.yaml"), "meta: {source: {video: a}}\n");
    expect(hasVoiceover(library, "voiced")).toBe(true);
    expect(hasVoiceover(library, "cut")).toBe(false);
    expect(hasVoiceover(library, "missing")).toBe(false);
    expect(hasVoiceover(library, "../voiced")).toBe(false);
  });
});

describe("readVoiceoverPlan", () => {
  const plan = (voiceover) =>
    readVoiceoverPlan({ meta: { voiceover }, scenes: [{ id: "a", captions: [{ text: "Hi" }] }] });

  it("fills in the defaults", () => {
    expect(plan({}).settings).toEqual({
      provider: "polly",
      voice: "Matthew",
      engine: "generative",
      track: "voiceover",
      leadMs: 250,
      tailMs: 450,
      holdMs: 1500,
    });
  });

  it("names what is wrong with the settings", () => {
    const { errors } = plan({ polly: { engine: "loud" }, leadMs: 1.5, track: "a/b", speed: 2 });
    expect(errors.join("\n")).toMatch(/engine must be one of/);
    expect(errors.join("\n")).toMatch(/leadMs must be a whole number/);
    expect(errors.join("\n")).toMatch(/track is an asset key/);
    expect(errors.join("\n")).toMatch(/speed is not a setting/);
  });

  it("drops an extension from the track name", () => {
    expect(plan({ track: "voice.m4a" }).settings.track).toBe("voice");
  });

  it("checks the scenes the voice reads against the showcase", () => {
    const scenes = [
      { id: "a", captions: [{ text: "Hi" }] },
      { id: "b", captions: [{ text: "There" }] },
      { id: "card" },
    ];
    const read = (voiceover) => readVoiceoverPlan({ meta: { voiceover }, scenes });
    expect(read({}).scenes.map((s) => s.voiced)).toEqual([true, true, true]);
    const some = read({ scenes: ["b"] });
    expect(some.ok).toBe(true);
    expect(some.scenes.map((s) => s.voiced)).toEqual([false, true, false]);
    expect(some.settings.scenes).toEqual(["b"]);
    expect(read({ scenes: "b" }).errors.join()).toMatch(/scenes must be a list of scene ids/);
    expect(read({ scenes: [] }).errors.join()).toMatch(/scenes is empty/);
    expect(read({ scenes: ["ghost"] }).errors.join()).toMatch(
      /names "ghost", and no scene has that id/,
    );
    expect(read({ scenes: ["card"] }).errors.join()).toMatch(
      /None of the scenes .* has a caption to read/,
    );
  });
});

describe("the pieces", () => {
  it("lays windows end to end, with the hold on the last caption", () => {
    const { windows, totalMs } = layOutWindows(
      [{ spokenMs: 1000 }, { silenceMs: 2000 }, { spokenMs: 500 }, { silenceMs: 300 }],
      { leadMs: 250, tailMs: 450, holdMs: 1500 },
    );
    expect(windows.map((w) => [w.startMs, w.durationMs])).toEqual([
      [0, 1700],
      [1700, 2000],
      [3700, 2700],
      [6400, 300],
    ]);
    expect(totalMs).toBe(6700);
  });

  it("drops punctuation from a caption's words but keeps a leading slash", () => {
    expect(captionWords('Type /showcase, and "shorts" — it\'s built-in.')).toEqual([
      "Type",
      "/showcase",
      "and",
      "shorts",
      "it's",
      "built-in",
    ]);
  });

  it("splits the words whisper joins at a slash", () => {
    expect(splitHeardWords([{ text: " type/showcase", startMs: 0, endMs: 1300 }])).toEqual([
      { text: "type", startMs: 0, endMs: 400 },
      { text: "/showcase", startMs: 400, endMs: 1300 },
    ]);
    expect(splitHeardWords([{ text: " /showcase", startMs: 0, endMs: 10 }])).toEqual([
      { text: "/showcase", startMs: 0, endMs: 10 },
    ]);
  });

  it("finds where a clip is voiced, past its quiet edges", () => {
    const pcm = Buffer.alloc(24 * 1000 * 2);
    for (let i = 24 * 200; i < 24 * 700; i++) pcm.writeInt16LE(i % 2 ? 4000 : -4000, i * 2);
    expect(voicedSpan(pcm)).toEqual({ onMs: 200, offMs: 700 });
  });

  it("fits the heard words linearly into the voiced span", () => {
    const { segment, fitted } = captionSegment(
      {
        text: "One two.",
        startMs: 1000,
        durationMs: 2000,
        voiced: { onMs: 100, offMs: 1100 },
        heard: [
          { text: "one", startMs: 0, endMs: 400 },
          { text: "two", startMs: 500, endMs: 2000 },
        ],
      },
      { leadMs: 250 },
    );
    expect(fitted).toBe(true);
    expect(segment.words).toEqual([
      { text: "One", startMs: 1350, endMs: 1550 },
      { text: "two", startMs: 1600, endMs: 2350 },
    ]);
  });

  it("spreads the words by length when whisper heard a different number", () => {
    const { segment, fitted } = captionSegment(
      {
        text: "ab abcd",
        startMs: 0,
        durationMs: 2000,
        voiced: { onMs: 0, offMs: 600 },
        heard: [{ text: "abababcd", startMs: 0, endMs: 600 }],
      },
      { leadMs: 0 },
    );
    expect(fitted).toBe(false);
    expect(segment.words).toEqual([
      { text: "ab", startMs: 0, endMs: 200 },
      { text: "abcd", startMs: 200, endMs: 600 },
    ]);
  });
});

/* The voice settings are typed per provider; the older flat ones are
 * moved into the Polly block when the studio opens a library. */
describe("the voice block", () => {
  const plan = (voiceover) =>
    readVoiceoverPlan({ meta: { voiceover }, scenes: [{ id: "a", captions: [{ text: "Hi" }] }] });
  const errors = (voiceover) => plan(voiceover).errors.join("\n");

  it("reads Polly's settings from its block, and Polly's defaults with no block", () => {
    expect(plan({ polly: { voice: "Joanna", engine: "neural" } }).settings).toMatchObject({
      provider: "polly",
      voice: "Joanna",
      engine: "neural",
    });
    expect(plan({ track: "vo" }).settings).toMatchObject({
      provider: "polly",
      voice: "Matthew",
      engine: "generative",
      track: "vo",
    });
  });

  it("refuses the older flat settings, saying where each goes", () => {
    expect(errors({ voice: "Joanna" })).toBe(
      'meta.voiceover.voice goes in a voice block now — e.g. {polly: {voice: "Joanna"}} ' +
        "(migrateVoiceoverYaml moves it)",
    );
  });

  it("refuses two blocks, and a setting the block's provider doesn't take", () => {
    expect(errors({ polly: {}, elevenlabs: { voice: "x" } })).toMatch(
      /has polly and elevenlabs — one voice block/,
    );
    expect(errors({ polly: { model: "eleven_v4" } })).toMatch(
      /meta.voiceover.polly.model isn't one of Polly's settings — use: voice, engine, profile, region/,
    );
    expect(errors({ polly: "Matthew" })).toMatch(/meta.voiceover.polly must be a map/);
  });

  it("moves flat Polly settings into the block, keeping comments and layout", () => {
    const flow =
      "meta:\n  voiceover: { voice: Matthew, engine: generative, track: vo }\nscenes: []\n";
    expect(migrateVoiceoverYaml(flow)).toBe(
      "meta:\n  voiceover: { polly: { voice: Matthew, engine: generative }, track: vo }\n" +
        "scenes: []\n",
    );
    const block =
      "# a showcase\nmeta:\n  voiceover:\n    track: vo # the track\n    voice: Joanna # warm\n" +
      "    region: eu-west-1\n    say:\n      GitHub: Git Hub # spelled out\nscenes: []\n";
    expect(migrateVoiceoverYaml(block)).toBe(
      "# a showcase\nmeta:\n  voiceover:\n    track: vo # the track\n    polly:\n" +
        "      voice: Joanna # warm\n      region: eu-west-1\n    say:\n" +
        "      GitHub: Git Hub # spelled out\nscenes: []\n",
    );
    const moved = parse(migrateVoiceoverYaml(block));
    expect(
      readVoiceoverPlan({ ...moved, scenes: [{ id: "a", captions: [{ text: "Hi" }] }] }),
    ).toMatchObject({ ok: true, settings: { voice: "Joanna", region: "eu-west-1" } });
  });

  it("leaves a showcase with nothing to move alone", () => {
    for (const text of [
      "meta:\n  title: X\nscenes: []\n",
      "meta:\n  voiceover: { polly: { voice: Matthew }, track: vo }\nscenes: []\n",
      "meta:\n  voiceover: { track: vo }\nscenes: []\n",
      "meta: [\n",
    ]) {
      expect(migrateVoiceoverYaml(text)).toBeUndefined();
    }
  });

  it("keeps a Polly clip's cache, so a moved showcase voices nothing again", async () => {
    await build();
    writeFileSync(
      path.join(library, "voiced", "showcase.yaml"),
      SHOWCASE.replace(
        "{ polly: { voice: Matthew, engine: generative }, track: voiceover-synth }",
        "{ voice: Matthew, engine: generative, track: voiceover-synth }",
      ),
    );
    const writes = [];
    expect(
      migrateLibraryVoiceovers(library, (file, text) => {
        writes.push(file);
        writeFileSync(file, text);
      }),
    ).toEqual(["voiced"]);
    expect(writes).toEqual([path.join(library, "voiced", "showcase.yaml")]);
    calls = [];
    expect(await build()).toMatchObject({ ok: true, synthesized: 0, reused: 4 });
    expect(migrateLibraryVoiceovers(library, () => writes.push("again"))).toEqual([]);
  });
});
