import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LIBRARY_TEMPLATES_DIR,
  findTemplate,
  listTemplates,
  starterShowcaseYaml,
} from "./showcase-templates.mjs";
import { SHOWCASE_SCHEMA } from "../src/content/showcase-schema.mjs";

let library;
beforeEach(() => {
  library = mkdtempSync(path.join(tmpdir(), "templates-"));
});
afterEach(() => rmSync(library, { recursive: true, force: true }));

const addLibraryTemplate = (file, text) => {
  mkdirSync(path.join(library, LIBRARY_TEMPLATES_DIR), { recursive: true });
  writeFileSync(path.join(library, LIBRARY_TEMPLATES_DIR, file), text);
};

describe("the shipped templates", () => {
  it("are a feature explainer, a how-to, a product launch and a worked example, all readable", () => {
    const { templates, problems } = listTemplates(library);
    expect(problems).toEqual([]);
    expect(templates.map((t) => t.id)).toEqual([
      "feature-explainer",
      "how-to",
      "product-launch",
      "worked-example",
    ]);
    for (const t of templates) {
      expect(t.source).toBe("studio");
      expect(t.meta.targetMs).toBeGreaterThan(0);
      expect(t.meta.sceneMaxMs).toBeGreaterThan(0);
      expect(t.meta.view).toBeTruthy();
      expect(t.guidance.length).toBeGreaterThan(100);
      expect(t.titles.good.length).toBeGreaterThan(0);
      expect(t.titles.bad.length).toBeGreaterThan(0);
      expect(t.scenes.length).toBeGreaterThan(2);
    }
  });

  it("only use scene fields and themes the schema knows", () => {
    const sceneFields = Object.keys(SHOWCASE_SCHEMA.properties.scenes.items.properties);
    for (const t of listTemplates(library).templates) {
      for (const scene of t.scenes) {
        for (const key of Object.keys(scene)) expect(sceneFields).toContain(key);
        expect(["statement", "feature", "console", "footage"]).toContain(scene.theme);
      }
    }
  });
});

describe("what check_titles asks", () => {
  it("is the story question for a worked example, and what each slide shows otherwise", () => {
    expect(findTemplate(library, "worked-example").titleCheck).toBe("story");
    expect(findTemplate(library, "feature-explainer").titleCheck).toBe("screen");
  });
});

describe("a library's own templates", () => {
  it("are added to the list, and one with a shipped id replaces it", () => {
    addLibraryTemplate("team-update.yaml", "name: Team update\nscenes:\n  - id: news\n");
    addLibraryTemplate("how-to.yaml", "name: Our how-to\nmeta:\n  targetMs: 30000\n");
    const { templates, problems } = listTemplates(library);
    expect(problems).toEqual([]);
    expect(templates.map((t) => `${t.id}:${t.source}`)).toEqual([
      "feature-explainer:studio",
      "how-to:library",
      "product-launch:studio",
      "worked-example:studio",
      "team-update:library",
    ]);
    expect(findTemplate(library, "how-to").name).toBe("Our how-to");
  });

  it("are left out with a problem when a file is wrong, never stopping the list", () => {
    addLibraryTemplate("broken.yaml", "name: [unclosed\n");
    addLibraryTemplate("no-name.yaml", "description: x\n");
    addLibraryTemplate("loud.yaml", "name: Loud\nmeta:\n  captionStyle: karaoke\n");
    addLibraryTemplate("bad-view.yaml", "name: Bad\nmeta:\n  view: cinema\n");
    addLibraryTemplate("other.yaml", "name: Other\n");
    addLibraryTemplate("Capital.yaml", "name: Capital\n");
    addLibraryTemplate("odd-check.yaml", "name: Odd\ntitleCheck: vibes\n");
    const { templates, problems } = listTemplates(library);
    expect(templates).toHaveLength(4);
    expect(problems).toHaveLength(7);
    expect(problems.join("\n")).toContain("odd-check.yaml: titleCheck must be screen or story");
    expect(problems.join("\n")).toContain("meta.captionStyle can't be set by a template");
    expect(problems.join("\n")).toContain(`${LIBRARY_TEMPLATES_DIR}/no-name.yaml: needs a name`);
  });
});

describe("a new showcase's starter showcase.yaml", () => {
  it("is the one-scene starter with no template", () => {
    const doc = parse(starterShowcaseYaml("Play Together!"));
    expect(doc.meta).toEqual({
      title: "Play Together!",
      description: "Describe Play Together! in a sentence.",
      loop: true,
    });
    expect(doc.scenes.map((s) => s.id)).toEqual(["intro"]);
  });

  it("takes a template's settings and scenes, and names the template", () => {
    const template = findTemplate(library, "how-to");
    const doc = parse(starterShowcaseYaml("Export a PDF", { template }));
    expect(doc.meta).toMatchObject({ ...template.meta, template: "how-to" });
    expect(doc.scenes.map((s) => s.id)).toEqual(template.scenes.map((s) => s.id));
    expect(doc.scenes.every((s) => s.media?.kind === "none")).toBe(true);
  });

  it('keeps the answer to "what is this video for?" in meta.notes', () => {
    const doc = parse(starterShowcaseYaml("Odd One", { purpose: "A thank-you to our testers" }));
    expect(doc.meta.notes).toBe("What this video is for: A thank-you to our testers");
    expect(doc.meta.template).toBeUndefined();
  });
});
