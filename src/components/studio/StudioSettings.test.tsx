import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StudioHistory } from "@/lib/studio";
import { AUTO_COMMIT_HELP, autoCommitExplanation } from "./auto-commit-text";
import { AutoCommitSwitch } from "./StudioSettings";

const onMain: StudioHistory = {
  git: true,
  autoCommit: true,
  enabled: true,
  available: true,
  branch: "main",
  root: "/work/app",
};

const notRepo: StudioHistory = {
  git: false,
  autoCommit: false,
  enabled: true,
  available: false,
  branch: null,
  reason:
    "This library isn't in a git repository, so the studio keeps no history. " +
    "Run git init in /work/showcases to turn on history.",
};

const draw = (status: StudioHistory | null | undefined, saving = false) =>
  renderToStaticMarkup(<AutoCommitSwitch status={status} saving={saving} onChange={() => {}} />);

/* The switch button's own markup: <button role="switch" ...>. */
const switchTag = (html: string) => html.match(/<button[^>]*role="switch"[^>]*>/)?.[0] ?? "";

describe("AutoCommitSwitch", () => {
  it("is a labeled, checked switch showing the branch when commits are on", () => {
    const html = draw(onMain);
    const button = switchTag(html);
    const id = button.match(/ id="([^"]+)"/)?.[1];
    expect(html).toContain(`<label class="text-sm font-medium`);
    expect(html).toContain(`for="${id}"`);
    expect(html).toContain("Commit changes to git");
    expect(button).toContain('aria-checked="true"');
    expect(button).not.toContain('disabled=""');
    expect(html).toContain("on main");
    expect(html).toContain(AUTO_COMMIT_HELP.replace("'", "&#x27;"));
  });

  it("is off, not disabled, when the user turned commits off", () => {
    const button = switchTag(draw({ ...onMain, autoCommit: false, enabled: false }));
    expect(button).toContain('aria-checked="false"');
    expect(button).not.toContain('disabled=""');
  });

  it("is disabled and says why outside a git repository", () => {
    const html = draw(notRepo);
    const button = switchTag(html);
    expect(button).toContain('aria-checked="false"');
    expect(button).toContain('disabled=""');
    expect(button).toContain('aria-disabled="true"');
    const describedBy = button.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(html).toMatch(new RegExp(`id="${describedBy}"[^>]*>This library isn&#x27;t in a git`));
    expect(html).toContain("Run git init in /work/showcases to turn on history.");
    expect(html).toContain("Not available");
    /* The wrapper takes focus instead, so the tooltip still shows. */
    expect(html).toMatch(/<span[^>]*tabindex="0"/);
  });

  it("is disabled while a change is being saved", () => {
    expect(switchTag(draw(onMain, true))).toContain('disabled=""');
  });
});

describe("autoCommitExplanation", () => {
  it("explains what the switch does, why it can't work, or that it is loading", () => {
    expect(autoCommitExplanation(onMain)).toBe(AUTO_COMMIT_HELP);
    expect(autoCommitExplanation(notRepo)).toBe(notRepo.reason);
    expect(autoCommitExplanation(undefined)).toBe("Checking git…");
    expect(autoCommitExplanation(null)).toContain("couldn't read");
    expect(
      autoCommitExplanation({ ...onMain, reason: "Commits wait: a merge is in progress." }),
    ).toBe(`${AUTO_COMMIT_HELP} Commits wait: a merge is in progress.`);
  });
});
