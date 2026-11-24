/* The ElevenLabs voice, beside Polly, with a stand-in for ElevenLabs'
 * endpoint: no network, no key. The stand-in answers every request with
 * a real WAV (a tone made by the bundled ffmpeg, as long as the text is),
 * so the build decodes, lays out and joins it as it would a real clip. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runFfmpeg } from "./ffmpeg.mjs";
import {
  ELEVENLABS_DEFAULT_MODEL,
  buildVoiceover,
  captionKey,
  elevenlabsSynthesizer,
  readVoiceoverPlan,
  resolveElevenLabs,
  voiceoverStatus,
} from "./voiceover.mjs";

/* Not a real key: a string to look for in everything the build leaves. */
const KEY = "sk_test_not_a_real_key_0123456789";
const WITH_KEY = { ELEVENLABS_API_KEY: KEY };
const AWS = { profiles: () => ["default"], regionOf: () => "us-east-1" };

let library;

/** A WAV of a tone as long as the text, the shape wav_24000 answers in. */
async function wavOf(text) {
  const file = path.join(library, `tone-${Math.random().toString(36).slice(2)}.wav`);
  await runFfmpeg([
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=f=440:r=24000:d=${(0.4 + text.length * 0.02).toFixed(3)}`,
    "-af",
    "adelay=100,apad=pad_dur=0.1",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    file,
  ]);
  return readFileSync(file);
}

/** ElevenLabs' endpoint, stood in for: records each request, answers
 *  with a WAV, or with `fail` when given. */
function fakeFetch(requests = [], { fail } = {}) {
  return async (url, init) => {
    requests.push({ url, ...init, body: JSON.parse(init.body) });
    if (fail) return new Response(fail.body, { status: fail.status });
    const wav = await wavOf(JSON.parse(init.body).text);
    return new Response(wav, { status: 200, headers: { "content-type": "audio/wav" } });
  };
}

const VOICE = "JBFqnCBsd6RMkjVDRZzb";

function write(voiceover, texts = ["Hello from the studio.", "Make a video today."]) {
  const lines = Object.entries(voiceover)
    .map(
      ([key, value]) => `    ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`,
    )
    .join("\n");
  const scenes = texts
    .map((text, i) => `  - id: s${i}\n    theme: statement\n    captions:\n      - text: ${text}`)
    .join("\n");
  writeFileSync(
    path.join(library, "voiced", "showcase.yaml"),
    `meta:\n  title: Voiced\n  voiceover:\n${lines}\nscenes:\n${scenes}\n`,
  );
}

const cacheFiles = () =>
  readdirSync(path.join(library, ".studio", "build", "voiceover", "voiced")).sort();

function build({ requests = [], env = WITH_KEY, ...options } = {}) {
  return buildVoiceover({
    showcasesDir: library,
    showcaseId: "voiced",
    synthesize: elevenlabsSynthesizer({ fetch: fakeFetch(requests), env }),
    transcribe: null,
    aws: AWS,
    env,
    ...options,
  });
}

beforeEach(async () => {
  library = await mkdtemp(path.join(os.tmpdir(), "studio-elevenlabs-"));
  mkdirSync(path.join(library, "voiced"));
});

afterEach(async () => {
  await rm(library, { recursive: true, force: true });
});

describe("the provider setting", () => {
  const plan = (voiceover) =>
    readVoiceoverPlan({ meta: { voiceover }, scenes: [{ id: "a", captions: [{ text: "Hi" }] }] });

  it("stays polly when unset, with a Polly clip's key unchanged", () => {
    const { settings } = plan({});
    expect(settings).toMatchObject({ provider: "polly", voice: "Matthew", engine: "generative" });
    expect(settings.model).toBeUndefined();
    /* The key every existing cache was written under. */
    expect(captionKey(settings, "Hi")).toBe(
      captionKey({ voice: "Matthew", engine: "generative" }, "Hi"),
    );
  });

  it("takes a voice and a model with ElevenLabs, and no engine", () => {
    const { ok, settings } = plan({ provider: "elevenlabs", voice: VOICE });
    expect(ok).toBe(true);
    expect(settings).toMatchObject({ provider: "elevenlabs", voice: VOICE });
    expect(settings.model).toBe(ELEVENLABS_DEFAULT_MODEL);
    expect(settings.engine).toBeUndefined();
    expect(plan({ provider: "elevenlabs", voice: VOICE, model: "eleven_v4" }).settings.model).toBe(
      "eleven_v4",
    );
  });

  it("names what doesn't belong with each provider", () => {
    const errors = (voiceover) => plan(voiceover).errors.join("\n");
    expect(errors({ provider: "elevenlabs" })).toMatch(/voice is required with ElevenLabs/);
    for (const key of ["engine", "profile", "region"]) {
      expect(errors({ provider: "elevenlabs", voice: VOICE, [key]: "x" })).toMatch(
        new RegExp(`${key} is a Polly setting`),
      );
    }
    expect(errors({ model: "eleven_v4" })).toMatch(/model is an ElevenLabs setting/);
    expect(errors({ provider: "azure" })).toMatch(/provider must be one of: polly, elevenlabs/);
  });
});

describe("elevenlabsSynthesizer", () => {
  it("posts the text and model to the voice's endpoint, for 24 kHz WAV, and writes it", async () => {
    const requests = [];
    const out = path.join(library, "clip.wav");
    await elevenlabsSynthesizer({ fetch: fakeFetch(requests), env: WITH_KEY })({
      text: "Hello.",
      voice: VOICE,
      model: "eleven_multilingual_v2",
      out,
    });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.url).toBe(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=wav_24000`,
    );
    expect(request.method).toBe("POST");
    expect(request.headers).toEqual({
      "xi-api-key": KEY,
      "content-type": "application/json",
      accept: "audio/wav",
    });
    expect(request.body).toEqual({ text: "Hello.", model_id: "eleven_multilingual_v2" });
    expect(readFileSync(out).subarray(0, 4).toString()).toBe("RIFF");
  });

  it("never puts the key in an error, even when ElevenLabs echoes it", async () => {
    const clip = { text: "Hi.", voice: VOICE, model: "m", out: path.join(library, "x.wav") };
    const refused = elevenlabsSynthesizer({
      fetch: fakeFetch([], {
        fail: { status: 401, body: JSON.stringify({ detail: { message: `Invalid key ${KEY}` } }) },
      }),
      env: WITH_KEY,
    })(clip);
    await expect(refused).rejects.toThrow(/ElevenLabs answered 401: Invalid key/);
    await expect(refused).rejects.not.toThrow(KEY);
    await expect(refused).rejects.toThrow(/check ELEVENLABS_API_KEY/);

    const unreachable = elevenlabsSynthesizer({
      fetch: async () => {
        throw new Error(`socket closed for ${KEY}`);
      },
      env: WITH_KEY,
    })(clip);
    await expect(unreachable).rejects.toThrow(/couldn't be reached/);
    await expect(unreachable).rejects.not.toThrow(KEY);

    const invalid = elevenlabsSynthesizer({
      fetch: fakeFetch([], {
        fail: { status: 422, body: JSON.stringify({ detail: [{ msg: "voice_id not valid" }] }) },
      }),
      env: WITH_KEY,
    })(clip);
    await expect(invalid).rejects.toThrow("ElevenLabs answered 422: voice_id not valid");
    expect(existsSync(clip.out)).toBe(false);
  });

  it("refuses to call ElevenLabs with no key", async () => {
    const requests = [];
    const call = elevenlabsSynthesizer({ fetch: fakeFetch(requests), env: {} })({
      text: "Hi.",
      voice: VOICE,
      model: "m",
      out: path.join(library, "x.wav"),
    });
    await expect(call).rejects.toThrow(/No ElevenLabs API key/);
    expect(requests).toEqual([]);
  });
});

describe("the ElevenLabs key", () => {
  it("is the status's problem before any build, and what the build refuses on", async () => {
    write({ provider: "elevenlabs", voice: VOICE });
    const status = voiceoverStatus({ showcasesDir: library, showcaseId: "voiced", env: {} });
    expect(status).toMatchObject({ built: true, kind: "voiceover", ok: false });
    expect(status.problem).toMatch(/set ELEVENLABS_API_KEY in the environment/);
    expect(status.problem).toMatch(/user's choice/);
    expect(status.problem).toMatch(/never pick one yourself/);
    expect(resolveElevenLabs({ env: { ELEVENLABS_API_KEY: "  " } }).ok).toBe(false);

    const requests = [];
    const result = await build({ requests, env: {} });
    expect(result).toEqual({ ok: false, error: status.problem });
    expect(requests).toEqual([]);
    expect(voiceoverStatus({ showcasesDir: library, showcaseId: "voiced", env: WITH_KEY }).ok).toBe(
      true,
    );
  });

  it("is never written into the library", async () => {
    write({ provider: "elevenlabs", voice: VOICE });
    expect(await build()).toMatchObject({ ok: true, synthesized: 2 });
    const everything = (dir) =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? everything(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
      );
    for (const file of everything(library)) {
      expect(readFileSync(file).includes(KEY), file).toBe(false);
    }
  });
});

describe("an ElevenLabs build", () => {
  it("voices every caption, and is up to date after", async () => {
    write({ provider: "elevenlabs", voice: VOICE });
    const requests = [];
    /* A whisper that hears nothing, so the words file counts as built. */
    const result = await build({ requests, transcribe: async () => ({ segments: [] }) });
    expect(result).toMatchObject({ ok: true, synthesized: 2, reused: 0 });
    expect(requests.map((r) => r.body.text)).toEqual([
      "Hello from the studio.",
      "Make a video today.",
    ]);
    expect(cacheFiles().filter((file) => !file.endsWith(".heard.json"))).toEqual([
      expect.stringMatching(/\.wav$/),
      expect.stringMatching(/\.wav$/),
    ]);
    const words = JSON.parse(
      readFileSync(path.join(library, "voiced", "assets", "voiceover.words.json"), "utf8"),
    );
    expect(JSON.stringify(words)).toMatch(/ElevenLabs eleven_multilingual_v2/);
    expect(
      voiceoverStatus({ showcasesDir: library, showcaseId: "voiced", env: WITH_KEY }),
    ).toMatchObject({ ok: true, upToDate: true });
  });

  it("never reuses a Polly clip, and makes every clip again for a new model", async () => {
    write({ voice: "Matthew" });
    const polly = [];
    const pollyBuild = await buildVoiceover({
      showcasesDir: library,
      showcaseId: "voiced",
      synthesize: async ({ text, out }) => {
        polly.push(text);
        writeFileSync(out, await wavOf(text));
      },
      transcribe: null,
      aws: AWS,
      env: {},
    });
    expect(pollyBuild).toMatchObject({ ok: true, synthesized: 2 });
    const pollyClips = cacheFiles().filter((file) => file.endsWith(".mp3"));
    expect(pollyClips).toHaveLength(2);

    write({ provider: "elevenlabs", voice: "Matthew" });
    expect(
      voiceoverStatus({ showcasesDir: library, showcaseId: "voiced", env: WITH_KEY }).stale,
    ).toContain("2 captions to voice");
    const requests = [];
    expect(await build({ requests })).toMatchObject({ ok: true, synthesized: 2, reused: 0 });
    expect(requests).toHaveLength(2);

    expect(await build({ requests })).toMatchObject({ ok: true, synthesized: 0, reused: 2 });
    write({ provider: "elevenlabs", voice: "Matthew", model: "eleven_flash_v2_5" });
    expect(await build({ requests })).toMatchObject({ ok: true, synthesized: 2, reused: 0 });
    expect(requests.at(-1).body.model_id).toBe("eleven_flash_v2_5");
    /* The Polly clips no caption reads any more are gone. */
    expect(cacheFiles().some((file) => pollyClips.includes(file))).toBe(false);
  });

  it("respells a say entry, and reads an ipa entry's word as written, with a note", async () => {
    write(
      { provider: "elevenlabs", voice: VOICE, say: { GitHub: "Git Hub", records: { ipa: "rɪ" } } },
      ["GitHub records Q&A today."],
    );
    const requests = [];
    const result = await build({ requests });
    expect(result.ok).toBe(true);
    expect(requests[0].body.text).toBe("Git Hub records Q&A today.");
    expect(result.notes.join("\n")).toMatch(
      /The say entry "records" \(ipa\) can't be sent to ElevenLabs/,
    );
  });
});
