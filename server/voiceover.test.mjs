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
import { mediaDuration, runFfmpeg } from "./ffmpeg.mjs";
import {
  buildVoiceover,
  captionSegment,
  captionWords,
  hasVoiceover,
  layOutWindows,
  readVoiceoverPlan,
  splitHeardWords,
  voicedSpan,
} from "./voiceover.mjs";

const toneSeconds = (text) => 0.4 + text.length * 0.02;

function fakePolly(calls = []) {
  return async ({ text, voice, engine, out }) => {
    calls.push({ text, voice, engine });
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
    const text = textOf(file);
    const heard = text
      .replace(/Type \/showcase/g, "type/showcase")
      .split(/\s+/)
      .filter(Boolean);
    const span = toneSeconds(text) * 1000;
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
  voiceover: { voice: Matthew, engine: generative, track: voiceover-synth }

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
    },
    transcribe: fakeWhisper((file) => spoken.get(file)),
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
      voice: "Matthew",
      engine: "generative",
      track: "voiceover",
      leadMs: 250,
      tailMs: 450,
      holdMs: 1500,
    });
  });

  it("names what is wrong with the settings", () => {
    const { errors } = plan({ engine: "loud", leadMs: 1.5, track: "a/b", speed: 2 });
    expect(errors.join("\n")).toMatch(/engine must be one of/);
    expect(errors.join("\n")).toMatch(/leadMs must be a whole number/);
    expect(errors.join("\n")).toMatch(/track is an asset key/);
    expect(errors.join("\n")).toMatch(/speed is not a setting/);
  });

  it("drops an extension from the track name", () => {
    expect(plan({ track: "voice.m4a" }).settings.track).toBe("voice");
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
