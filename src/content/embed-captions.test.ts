import { describe, expect, it } from "vitest";
import { embedCaptionsSetting, hasVoiceover } from "./embed-captions";

const voiceover = { src: "voiceover", volume: 1, sync: true };
const musicBed = { src: "music", volume: 0.2 };

describe("hasVoiceover", () => {
  it("needs a synced soundtrack with a source", () => {
    expect(hasVoiceover(voiceover)).toBe(true);
    expect(hasVoiceover(musicBed)).toBe(false);
    expect(hasVoiceover({ src: "", sync: true })).toBe(false);
    expect(hasVoiceover(undefined)).toBe(false);
  });
});

describe("embedCaptionsSetting", () => {
  it("shows captions by default when there is no voiceover", () => {
    expect(embedCaptionsSetting({})).toEqual({ shown: true, auto: true });
    expect(embedCaptionsSetting({ soundtrack: musicBed })).toEqual({ shown: true, auto: true });
  });

  it("hides captions by default when there is a voiceover", () => {
    expect(embedCaptionsSetting({ soundtrack: voiceover })).toEqual({ shown: false, auto: true });
  });

  it("follows meta.embedCaptions when it is set", () => {
    expect(embedCaptionsSetting({ soundtrack: voiceover, embedCaptions: true })).toEqual({
      shown: true,
      auto: false,
    });
    expect(embedCaptionsSetting({ embedCaptions: false })).toEqual({ shown: false, auto: false });
  });
});
