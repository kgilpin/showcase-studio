import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SETTINGS_TEMPLATE,
  ensureLibrarySettings,
  expandVariables,
  hasLibrarySettings,
  libraryAwsSettings,
  libraryConfig,
  libraryExportDir,
  librarySay,
  migrateLibrarySettings,
  readLibraryConfig,
  showInRecent,
} from "./library-config.mjs";

const dirs = [];
/** A folder with the given root files: { "showcase_settings.yaml": ... }. */
function folderWith(files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "library-config-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return dir;
}
/** A folder whose showcase_settings.yaml holds `settingsYaml` (none when null). */
const folder = (settingsYaml) =>
  folderWith(settingsYaml == null ? {} : { "showcase_settings.yaml": settingsYaml });

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe("showInRecent", () => {
  it("hides a folder only on an explicit show_in_recent: false", () => {
    expect(showInRecent(folder("show_in_recent: false\n"))).toBe(false);
    expect(showInRecent(folder("show_in_recent: true\n"))).toBe(true);
    expect(showInRecent(folder("something_else: false\n"))).toBe(true);
  });

  it("shows a folder with no settings file", () => {
    expect(showInRecent(folder(null))).toBe(true);
  });

  it("shows a folder whose settings file is broken or not a mapping", () => {
    expect(showInRecent(folder("show_in_recent: [unclosed"))).toBe(true);
    expect(showInRecent(folder("- just\n- a\n- list\n"))).toBe(true);
  });

  it("only reads the root file, never a showcase's own showcase.yaml", () => {
    const dir = folder(null);
    mkdirSync(path.join(dir, "demo"));
    writeFileSync(path.join(dir, "demo", "showcase.yaml"), "show_in_recent: false\n");
    expect(showInRecent(dir)).toBe(true);
  });
});

describe("librarySay", () => {
  it("reads the say map, and names the file in what it leaves out", () => {
    expect(librarySay(folder("say:\n  GitHub: Git Hub\n  AppMap: 3\n"))).toEqual({
      entries: [{ key: "GitHub", text: "Git Hub" }],
      warnings: [
        'showcase_settings.yaml say.AppMap must be text or {ipa: "..."}. The entry is ignored',
      ],
    });
    expect(librarySay(folder(null))).toEqual({ entries: [], warnings: [] });
  });

  it("is in the template, off", () => {
    expect(SETTINGS_TEMPLATE).toContain("# say:");
    expect(librarySay(folder(SETTINGS_TEMPLATE)).entries).toEqual([]);
  });
});

describe("libraryConfig", () => {
  it("returns the parsed mapping, and {} when there is nothing to read", () => {
    expect(libraryConfig(folder("show_in_recent: false\n"))).toEqual({ show_in_recent: false });
    expect(libraryConfig(folder(null))).toEqual({});
  });
});

describe("an older library's root showcase.yaml", () => {
  it("is read as settings when there is no showcase_settings.yaml", () => {
    const dir = folderWith({ "showcase.yaml": "show_in_recent: false\n" });
    expect(libraryConfig(dir)).toEqual({ show_in_recent: false });
    expect(showInRecent(dir)).toBe(false);
  });

  it("is ignored when showcase_settings.yaml is there", () => {
    const dir = folderWith({
      "showcase_settings.yaml": "show_in_recent: true\n",
      "showcase.yaml": "show_in_recent: false\n",
    });
    expect(showInRecent(dir)).toBe(true);
  });

  it("is a showcase's script, not settings, when it has scenes", () => {
    const dir = folderWith({ "showcase.yaml": "show_in_recent: false\nscenes: []\n" });
    expect(libraryConfig(dir)).toEqual({});
    expect(hasLibrarySettings(dir)).toBe(false);
  });

  it("is a showcase's script, not settings, when it has meta", () => {
    const dir = folderWith({ "showcase.yaml": "meta:\n  title: Draft\n" });
    expect(hasLibrarySettings(dir)).toBe(false);
  });
});

describe("hasLibrarySettings", () => {
  it("is true for showcase_settings.yaml or an old-style root showcase.yaml", () => {
    expect(hasLibrarySettings(folder("show_in_recent: false\n"))).toBe(true);
    expect(hasLibrarySettings(folderWith({ "showcase.yaml": "show_in_recent: false\n" }))).toBe(
      true,
    );
    expect(hasLibrarySettings(folder(null))).toBe(false);
  });
});

describe("migrateLibrarySettings", () => {
  const read = (dir, name) => readFileSync(path.join(dir, name), "utf8");

  it("renames old-style settings to showcase_settings.yaml", () => {
    const dir = folderWith({ "showcase.yaml": "show_in_recent: false\n" });
    expect(migrateLibrarySettings(dir)).toBe(true);
    expect(existsSync(path.join(dir, "showcase.yaml"))).toBe(false);
    expect(read(dir, "showcase_settings.yaml")).toBe("show_in_recent: false\n");
  });

  it("leaves a showcase's script, and a folder that already has the new file, alone", () => {
    const script = folderWith({ "showcase.yaml": "meta:\n  title: Nova\nscenes: []\n" });
    expect(migrateLibrarySettings(script)).toBe(false);
    expect(existsSync(path.join(script, "showcase.yaml"))).toBe(true);
    const both = folderWith({
      "showcase_settings.yaml": "show_in_recent: true\n",
      "showcase.yaml": "show_in_recent: false\n",
    });
    expect(migrateLibrarySettings(both)).toBe(false);
    expect(read(both, "showcase.yaml")).toBe("show_in_recent: false\n");
  });
});

describe("a setting that names an environment variable", () => {
  it("is read with ${NAME} replaced, and reported when NAME isn't set", () => {
    expect(expandVariables("${USER}-${HOME}", { USER: "pat", HOME: "/h" })).toEqual({
      value: "pat-/h",
      missing: [],
    });
    expect(expandVariables("${USER}", {})).toEqual({ value: "${USER}", missing: ["USER"] });
    /* $USER alone, or a lone brace, is plain text. */
    expect(expandVariables("$USER {x}", { USER: "pat" })).toEqual({
      value: "$USER {x}",
      missing: [],
    });
  });

  it("applies to every setting in the file", () => {
    const dir = folder("export_dir: ${OUT}/exports\naws_profile: ${USER}\nshow_in_recent: false\n");
    expect(readLibraryConfig(dir, { OUT: "/tmp/out", USER: "pat" })).toEqual({
      settings: { export_dir: "/tmp/out/exports", aws_profile: "pat", show_in_recent: false },
      problems: [],
    });
    expect(readLibraryConfig(dir, {})).toEqual({
      settings: { export_dir: "${OUT}/exports", aws_profile: "${USER}", show_in_recent: false },
      problems: [
        "showcase_settings.yaml export_dir: ${OUT}/exports — OUT isn't set in the environment",
        "showcase_settings.yaml aws_profile: ${USER} — USER isn't set in the environment",
      ],
    });
  });
});

describe("libraryAwsSettings", () => {
  it("is the aws_profile and aws_region, expanded, or nothing", () => {
    expect(libraryAwsSettings(folder(null))).toEqual({});
    expect(libraryAwsSettings(folder("aws_profile: work\n"), {})).toEqual({ profile: "work" });
    expect(
      libraryAwsSettings(folder("aws_profile: ${USER}\naws_region: eu-west-1\n"), { USER: "pat" }),
    ).toEqual({ profile: "pat", region: "eu-west-1" });
  });

  it("reports a variable that isn't set, or a value that isn't text, as its problem", () => {
    expect(libraryAwsSettings(folder("aws_profile: ${USER}\n"), {})).toEqual({
      problem: "showcase_settings.yaml aws_profile: ${USER} — USER isn't set in the environment",
    });
    expect(libraryAwsSettings(folder("aws_profile: 12\naws_region: ''\n"), {})).toEqual({
      problem:
        "showcase_settings.yaml aws_profile must be text\nshowcase_settings.yaml aws_region must be text",
    });
    /* Another setting's unset variable is not this one's problem. */
    expect(libraryAwsSettings(folder("export_dir: ${OUT}\naws_profile: work\n"), {})).toEqual({
      profile: "work",
    });
  });

  it("is in the template, commented out, with the variable left unexpanded", () => {
    expect(SETTINGS_TEMPLATE).toContain("# aws_profile: ${USER}");
    expect(SETTINGS_TEMPLATE).toContain("# aws_region: us-east-1");
  });
});

describe("ensureLibrarySettings", () => {
  it("writes the commented template, which sets nothing but marks a library", () => {
    const dir = folder(null);
    ensureLibrarySettings(dir);
    expect(readFileSync(path.join(dir, "showcase_settings.yaml"), "utf8")).toBe(SETTINGS_TEMPLATE);
    expect(libraryConfig(dir)).toEqual({});
    expect(showInRecent(dir)).toBe(true);
    expect(hasLibrarySettings(dir)).toBe(true);
  });

  it("keeps existing settings, and moves old ones rather than writing the template", () => {
    const kept = folder("show_in_recent: false\n");
    ensureLibrarySettings(kept);
    expect(showInRecent(kept)).toBe(false);
    const old = folderWith({ "showcase.yaml": "show_in_recent: false\n" });
    ensureLibrarySettings(old);
    expect(showInRecent(old)).toBe(false);
    expect(existsSync(path.join(old, "showcase.yaml"))).toBe(false);
  });
});

describe("libraryExportDir", () => {
  it("is the export_dir setting, resolved against the library", () => {
    const dir = folder("export_dir: exports\n");
    expect(libraryExportDir(dir)).toBe(path.join(dir, "exports"));
    /* An absolute path stays as it is. One with a drive on Windows: a
     * bare "/tmp" would take the drive of whichever folder it is
     * resolved against, and the library and the current folder can be on
     * different drives there. */
    const absolute = path.resolve(tmpdir(), "showcase-exports");
    expect(libraryExportDir(folder(`export_dir: "${absolute.replace(/\\/g, "\\\\")}"\n`))).toBe(
      absolute,
    );
    const spaced = folder("export_dir: '  renders  '\n");
    expect(libraryExportDir(spaced)).toBe(path.join(spaced, "renders"));
  });

  it("is unset without the setting, or with an empty or non-string one", () => {
    expect(libraryExportDir(folder(null))).toBeUndefined();
    expect(libraryExportDir(folder("show_in_recent: false\n"))).toBeUndefined();
    expect(libraryExportDir(folder("export_dir: ''\n"))).toBeUndefined();
    expect(libraryExportDir(folder("export_dir: 3\n"))).toBeUndefined();
    expect(libraryExportDir(folder("export_dir: [a, b]\n"))).toBeUndefined();
  });
});
