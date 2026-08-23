import { describe, expect, it } from "vitest";
import { prompterScriptFromYaml } from "./prompter-script.mjs";

const DOC = `meta:
  title: Fixture
  description: A fixture showcase.
  pace: 2.5
  soundtrack: { src: "", volume: 0.2 }

scenes:
  - id: intro
    theme: statement
    eyebrow: Opening
    title: On-screen only
    captions:
      - text: The first line.
      - text: The second line.
    support: A supporting line.
    media:
      kind: image
      asset: shot-one
      alt: A screenshot

  - id: pinned
    theme: feature
    durationMs: 8000
    captions:
      - text: A pinned line.
        durationMs: 3000
      - text: An untimed line.
    media:
      kind: none
`;

describe("prompterScriptFromYaml", () => {
  const script = prompterScriptFromYaml(DOC, "fixture", { publishedAt: "2026-08-23T00:00:00Z" });

  it("carries only what the prompter reads — no titles, media, or themes", () => {
    expect(script.version).toBe(1);
    expect(script.title).toBe("Fixture");
    expect(JSON.stringify(script)).not.toContain("On-screen only");
    expect(JSON.stringify(script)).not.toContain("shot-one");
    expect(JSON.stringify(script)).not.toContain("theme");
  });

  it("resolves derived timing so the page needs no pace model input", () => {
    const intro = script.scenes[0];
    expect(intro.eyebrow).toBe("Opening");
    expect(intro.support).toBe("A supporting line.");
    expect(intro.captions.map((c) => c.text)).toEqual(["The first line.", "The second line."]);
    // Derived mode: every caption gains a concrete duration and the scene
    // is exactly long enough to speak everything.
    for (const caption of intro.captions) expect(caption.durationMs).toBeGreaterThan(0);
    expect(intro.durationMs).toBeGreaterThan(0);
  });

  it("keeps budget mode intact: pinned captions timed, the rest open", () => {
    const pinned = script.scenes[1];
    expect(pinned.durationMs).toBe(8000);
    expect(pinned.captions[0].durationMs).toBe(3000);
    expect(pinned.captions[1].durationMs).toBeUndefined();
  });
});
