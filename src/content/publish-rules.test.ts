import { describe, expect, it } from "vitest";
import {
  captionWithHashtags,
  checkPublishEdit,
  normalizeHashtags,
  publishProblems,
  publishText,
} from "./publish-rules.mjs";

const META = { title: "Mirror", description: "Mirror your phone." };

describe("publishText", () => {
  it("falls back to the showcase's description and title", () => {
    expect(publishText(null, "youtube", META)).toEqual({
      caption: "Mirror your phone.",
      hashtags: [],
      title: "Mirror",
      from: { caption: "meta", hashtags: "none", title: "meta" },
    });
  });

  it("uses the default, then the destination's own override", () => {
    const publish = {
      caption: "Shared caption",
      hashtags: ["iphone", "productivity"],
      tiktok: { hashtags: ["techtok"] },
      instagram: { caption: "Link in bio." },
    };
    expect(publishText(publish, "tiktok", META)).toMatchObject({
      caption: "Shared caption",
      hashtags: ["techtok"],
      from: { caption: "publish", hashtags: "tiktok" },
    });
    expect(publishText(publish, "instagram", META)).toMatchObject({
      caption: "Link in bio.",
      hashtags: ["iphone", "productivity"],
      from: { caption: "instagram", hashtags: "publish" },
    });
    expect(publishText(publish, "tiktok", META)).not.toHaveProperty("title");
  });

  it("skips values it can't use", () => {
    const publish = { caption: "  ", hashtags: ["two words"], tiktok: "nope" };
    expect(publishText(publish, "tiktok", META)).toMatchObject({
      caption: "Mirror your phone.",
      hashtags: [],
    });
  });
});

describe("hashtags", () => {
  it("accepts a list or text, drops # and repeats (ignoring case)", () => {
    expect(normalizeHashtags(["#iPhone", "iphone", "tech_tok", "日本"])).toEqual([
      "iPhone",
      "tech_tok",
      "日本",
    ]);
    expect(normalizeHashtags("#a, #b c")).toEqual(["a", "b", "c"]);
    expect(() => normalizeHashtags(["no-dashes"])).toThrow(`"no-dashes" can't be a hashtag`);
    expect(() => normalizeHashtags(3)).toThrow("hashtags must be a list of words");
  });

  it("follow the caption on the same line for TikTok, which drops pasted blank lines", () => {
    expect(captionWithHashtags({ caption: "One\n\n\nTwo", hashtags: ["a"] }, "tiktok")).toBe(
      "One\nTwo #a",
    );
    expect(captionWithHashtags({ caption: "", hashtags: ["a"] }, "tiktok")).toBe("#a");
    expect(captionWithHashtags({ caption: "Hi", hashtags: ["a"] }, "instagram")).toBe("Hi\n\n#a");
  });

  it("puts them after the caption, with a blank line", () => {
    expect(captionWithHashtags({ caption: "Hi", hashtags: ["a", "b"] })).toBe("Hi\n\n#a #b");
    expect(captionWithHashtags({ caption: "", hashtags: ["a"] })).toBe("#a");
    expect(captionWithHashtags({ caption: "Hi", hashtags: [] })).toBe("Hi");
  });
});

describe("publishProblems", () => {
  it("names each limit a post goes over", () => {
    const tags = Array.from({ length: 31 }, (_, i) => `t${i}`);
    expect(
      publishProblems(
        "instagram",
        { caption: "x".repeat(2200), hashtags: tags },
        { durationMs: 200_000 },
      ),
    ).toEqual([
      expect.stringMatching(
        /^The Instagram caption with its hashtags is \d+ characters — the limit is 2200\.$/,
      ),
      "31 hashtags — Instagram allows 30.",
      "The video runs 200 seconds — Instagram takes up to 3 minutes.",
    ]);
  });

  it("needs a YouTube title under 100 characters", () => {
    expect(publishProblems("youtube", { caption: "", hashtags: [], title: "" })).toEqual([
      "YouTube Shorts needs a title.",
    ]);
    expect(
      publishProblems("youtube", { caption: "", hashtags: [], title: "t".repeat(101) }),
    ).toEqual(["The title is 101 characters — the limit is 100."]);
  });

  it("is empty for a post within every limit", () => {
    expect(
      publishProblems("tiktok", { caption: "Hi", hashtags: ["a"] }, { durationMs: 42_000 }),
    ).toEqual([]);
  });
});

/* A regular YouTube video takes the 4:3 export and has no 3-minute cap;
 * its text stands on its own, apart from the Short's. */
describe("YouTube (4:3)", () => {
  it("takes the 4:3 export and any length of video", () => {
    expect(
      publishProblems(
        "youtube43",
        { caption: "A walkthrough.", hashtags: ["tools"], title: "Setup" },
        { durationMs: 20 * 60_000 },
      ),
    ).toEqual([]);
    expect(
      publishProblems(
        "youtube",
        { caption: "A walkthrough.", hashtags: ["tools"], title: "Setup" },
        { durationMs: 20 * 60_000 },
      ),
    ).toEqual(["The video runs 1200 seconds — YouTube Shorts takes up to 3 minutes."]);
  });

  it("falls back to meta like the Short, but never to the Short's own text", () => {
    expect(publishText({}, "youtube43", META)).toMatchObject({
      title: "Mirror",
      caption: "Mirror your phone.",
      from: { title: "meta", caption: "meta" },
    });
    const publish = {
      youtube: { title: "Mirror in 10 seconds" },
      youtube43: { title: "Mirror: the full walkthrough" },
    };
    expect(publishText(publish, "youtube", META).title).toBe("Mirror in 10 seconds");
    expect(publishText(publish, "youtube43", META).title).toBe("Mirror: the full walkthrough");
    expect(publishText({ youtube: { title: "Short" } }, "youtube43", META)).toMatchObject({
      title: "Mirror",
      from: { title: "meta" },
    });
    expect(checkPublishEdit({ destination: "youtube43", name: "title", value: "T" })).toEqual({
      value: "T",
    });
  });
});

describe("checkPublishEdit", () => {
  it("returns the value to write, or removal", () => {
    expect(checkPublishEdit({ name: "caption", value: " Hi " })).toEqual({ value: "Hi" });
    expect(checkPublishEdit({ name: "caption", value: "" })).toEqual({ remove: true });
    expect(checkPublishEdit({ destination: "tiktok", name: "hashtags", value: null })).toEqual({
      remove: true,
    });
    expect(checkPublishEdit({ destination: "youtube", name: "title", value: "T" })).toEqual({
      value: "T",
    });
  });

  it("refuses unknown fields and non-text values", () => {
    expect(() => checkPublishEdit({ name: "cover", value: "x" })).toThrow(
      'publish has no field "cover" — fields: caption, hashtags, title',
    );
    expect(() => checkPublishEdit({ name: "caption", value: 3 })).toThrow(
      "publish caption must be text",
    );
  });
});
