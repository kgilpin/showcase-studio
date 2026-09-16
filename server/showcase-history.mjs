/* Showcase history: the studio commits each showcase's changes to git as
 * they happen, so the user (or Claude) can review a change, revert it, or
 * branch a new cut later.
 *
 *   a file in <library>/<id>/ changes      (studio UI, edit_showcase, or
 *            │                              anyone editing the files)
 *            ▼
 *   wait for a quiet period (5 s by default, per showcase)
 *            │
 *            ▼
 *   checks: git installed? library in a git work tree? commits turned on?
 *           no merge/rebase/etc. in progress, no index.lock, HEAD on a branch?
 *           anything changed in <id>/?
 *            │ all yes
 *            ▼
 *   git add -A -- <id>
 *   git commit -m "<id>: <summary>" -- <id>    (only that folder: the user's
 *            │                                  other staged work stays staged)
 *            ▼
 *   a "commit" line in .studio/changes.jsonl
 *
 * The summary comes from the change log entries made since the showcase's
 * last commit, plus the names of any changed files no entry explains.
 *
 * The studio never runs `git init`: a library outside a git repository
 * just reports that it has no history. The setting `autoCommit: false`
 * turns commits off, including commit_showcase.
 *
 * A git operation the user or Claude runs (checkout, revert, switching
 * branches) changes files, so it reaches us like any other change. It
 * leaves the showcase folder matching a commit, so `git status` is clean
 * and nothing is committed. */
import { execFile } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { createChangeLog } from "./change-log.mjs";

export const TRAILER = "Showcase-Studio";
const SUBJECT_LIMIT = 72;

/* The files git leaves in its folder while an operation is half done. */
const BUSY_MARKERS = [
  ["MERGE_HEAD", "a merge"],
  ["rebase-merge", "a rebase"],
  ["rebase-apply", "a rebase"],
  ["CHERRY_PICK_HEAD", "a cherry-pick"],
  ["REVERT_HEAD", "a revert"],
  ["BISECT_LOG", "a bisect"],
  ["index.lock", "another git command (index.lock exists)"],
];

/** Runs git and resolves with { code, stdout, stderr }; never rejects,
 *  except with code "ENOENT" when git isn't installed. */
function runGit(gitPath, args, cwd) {
  /* A studio started from inside a git hook would inherit these, and they
   * would point every command at the wrong repository. */
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[name];
  return new Promise((resolve) => {
    execFile(gitPath, args, { cwd, env, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      /* A missing working folder fails with ENOENT too; that isn't git. */
      if (error?.code === "ENOENT" && existsSync(cwd)) {
        resolve({ code: "ENOENT", stdout: "", stderr: String(error.message) });
        return;
      }
      resolve({
        code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0,
        stdout,
        stderr,
      });
    });
  });
}

/** `git status --porcelain -z` output as [{ code, file, from? }]. */
function parseStatus(text) {
  const parts = text.split("\0");
  const files = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;
    const code = part.slice(0, 2);
    const entry = { code, file: part.slice(3) };
    if (code.includes("R") || code.includes("C")) entry.from = parts[++i];
    files.push(entry);
  }
  return files;
}

const verbFor = (code) => {
  if (code === "??" || code[0] === "A") return "add";
  if (code.includes("D")) return "delete";
  if (code.includes("R")) return "rename";
  return "edit";
};

const SOURCES = { ui: "studio UI", mcp: "Claude, via edit_showcase" };

/** One short phrase per change log edit, e.g. "edit intro caption 1 text". */
function describeEdit(edit = {}) {
  const scene = edit.sceneId ?? "";
  const caption = Number.isInteger(edit.captionIndex) ? `caption ${edit.captionIndex + 1}` : "";
  switch (edit.field) {
    case "scene.set":
      return `edit ${scene} ${edit.name}`;
    case "caption.set":
      return `edit ${scene} ${caption} ${edit.name}`;
    case "caption.insert":
      return `add ${scene} ${caption}`;
    case "caption.delete":
      return `delete ${scene} ${caption}`;
    case "scene.insert":
      return `add scene ${edit.scene?.id ?? ""}`;
    case "scene.delete":
      return `delete scene ${scene}`;
    case "scene.move":
      return `move scene ${scene}`;
    case "meta.set":
      return `set ${edit.name}`;
    case "media.set":
      return `set ${scene} media`;
    case "media.asset":
      return `point ${scene} at ${edit.value}`;
    case "theme":
      return `set theme ${edit.name}`;
    default:
      return `edit ${scene} ${edit.field ?? ""}`;
  }
}

/** What one change log entry did, as phrases, and the showcase files it
 *  explains (relative to the showcase folder). */
function describeEntry(entry) {
  const clean = (s) => s.replace(/\s+/g, " ").trim();
  switch (entry.kind) {
    case "edit":
      return {
        phrases: (entry.edits ?? []).map((edit) => clean(describeEdit(edit))),
        files: entry.file ? [entry.file] : [],
      };
    case "asset.add":
      return {
        phrases: [`add ${(entry.names ?? []).map((n) => `assets/${n}`).join(", ")}`],
        files: (entry.names ?? []).map((n) => `assets/${n}`),
      };
    case "asset.rename":
      return {
        phrases: [`rename assets/${entry.from} to ${entry.to}`],
        files: [`assets/${entry.from}`, `assets/${entry.to}`, ...(entry.file ? [entry.file] : [])],
      };
    case "asset.delete":
      return { phrases: [`delete assets/${entry.name}`], files: [`assets/${entry.name}`] };
    case "showcase.create":
      return { phrases: ["create the showcase"], files: ["showcase.yaml"] };
    default:
      return { phrases: [entry.kind], files: [] };
  }
}

/** The commit message for one showcase's changes: a subject, a body that
 *  lists every change and who made it, and the trailer.
 *
 *    entries  change log entries since the last commit (oldest first)
 *    files    [{ verb, file }] from git status, relative to the showcase
 *    message  a message of Claude's own (commit_showcase), if any */
export function commitMessage({ showcaseId, entries = [], files = [], message }) {
  const lines = []; // [{ phrase, who }]
  const explained = new Set();
  for (const entry of entries) {
    const { phrases, files: covered } = describeEntry(entry);
    covered.forEach((file) => explained.add(file));
    const who = SOURCES[entry.source] ?? entry.source;
    for (const phrase of phrases) {
      if (!lines.some((l) => l.phrase === phrase && l.who === who)) lines.push({ phrase, who });
    }
  }
  const unexplained = files.filter(({ file }) => !explained.has(file));
  const byVerb = new Map();
  for (const { verb, file } of unexplained) byVerb.set(verb, [...(byVerb.get(verb) ?? []), file]);
  const fileGroups = [...byVerb].map(([verb, names]) => `${verb} ${names.join(", ")}`);
  for (const group of fileGroups) lines.push({ phrase: group, who: "files changed directly" });

  let subject;
  if (message) {
    subject = message.startsWith(`${showcaseId}: `) ? message : `${showcaseId}: ${message}`;
  } else {
    const phrases = [...new Set(lines.map((l) => l.phrase))];
    subject = `${showcaseId}: ${phrases[0] ?? "update"}`;
    for (let i = 1; i < phrases.length; i += 1) {
      const rest = phrases.length - i - 1;
      const tail = rest > 0 ? `, and ${rest} more` : "";
      /* "; " between phrases that list files, which have commas of their own. */
      const joiner = phrases[i].includes(",") || phrases[i - 1].includes(",") ? "; " : ", ";
      const next = `${subject}${joiner}${phrases[i]}`;
      if ((next + tail).length > SUBJECT_LIMIT) {
        subject += `, and ${phrases.length - i} more`;
        break;
      }
      subject = next;
    }
  }

  const body = lines.length
    ? ["Changes, oldest first:", ...lines.map((l) => `- ${l.phrase} (${l.who})`)].join("\n")
    : "";
  const trailer = `${TRAILER}: ${message ? "checkpoint" : "auto-commit"}`;
  return { subject, body, trailer, text: [subject, body, trailer].filter(Boolean).join("\n\n") };
}

/**
 * Creates the history keeper for a studio.
 *
 *   getLibrary          the current library folder (it can switch)
 *   settings            { load } — `autoCommit: false` turns commits off
 *   delayMs             the quiet period before a commit
 *   failureCooldownMs   after a failed commit (a hook said no), how long
 *                       automatic commits for that showcase wait
 *   gitPath             the git program
 */
export function createShowcaseHistory({
  getLibrary,
  settings = { load: () => ({}) },
  delayMs = 5000,
  failureCooldownMs = 60_000,
  gitPath = "git",
  log = (message) => console.log(message),
}) {
  const pending = new Map(); // showcase folder → timer
  const failedAt = new Map(); // showcase folder → time of the last failed commit
  let gitMissing; // undefined until checked

  /* One git command sequence at a time: two showcases committing at once
   * would trip over each other's index.lock. */
  let queue = Promise.resolve();
  const inTurn = (work) => {
    const turn = queue.then(work);
    queue = turn.catch(() => {});
    return turn;
  };

  async function git(args, cwd) {
    const result = await runGit(gitPath, args, cwd);
    if (result.code === "ENOENT" && !gitMissing) {
      gitMissing = true;
      log("studio: git isn't installed, so showcase changes won't be committed");
    }
    return result;
  }

  const enabled = () => settings.load()?.autoCommit !== false;

  /** Where the folder sits in git: { root } or { reason }. */
  async function repoOf(dir) {
    if (gitMissing) return { reason: "git isn't installed" };
    const top = await git(["rev-parse", "--show-toplevel"], dir);
    if (top.code === "ENOENT") return { reason: "git isn't installed" };
    if (top.code !== 0) {
      return {
        notRepo: true,
        reason:
          "The library isn't in a git repository, so the studio keeps no history. " +
          "Run `git init` in the library to turn history on.",
      };
    }
    return { root: top.stdout.trim() };
  }

  /** Why git is busy right now (a merge, a rebase, …), or undefined. */
  async function busyReason(root) {
    const args = ["rev-parse", ...BUSY_MARKERS.flatMap(([name]) => ["--git-path", name])];
    const result = await git(args, root);
    if (result.code !== 0) return "git couldn't be read";
    const paths = result.stdout.trim().split("\n");
    const hit = BUSY_MARKERS.find((_, i) => paths[i] && existsSync(path.resolve(root, paths[i])));
    return hit ? `${hit[1]} is in progress` : undefined;
  }

  async function branchOf(root) {
    const result = await git(["symbolic-ref", "-q", "--short", "HEAD"], root);
    return result.code === 0 ? result.stdout.trim() : null;
  }

  /** The history facts for studio_info and studio_start:
   *  { git, autoCommit, branch, reason? }. */
  async function status() {
    const library = getLibrary();
    if (!existsSync(library)) {
      return { git: false, autoCommit: false, branch: null, reason: "The library folder is gone." };
    }
    const repo = await repoOf(library);
    if (!repo.root) return { git: false, autoCommit: false, branch: null, reason: repo.reason };
    const branch = await branchOf(repo.root);
    const on = enabled();
    const relLibrary = path.relative(realpathSync(repo.root), realpathSync(library));
    const ignored =
      relLibrary !== "" &&
      (await git(["check-ignore", "-q", `${relLibrary}/`], repo.root)).code === 0;
    let reason;
    if (!on) reason = "Commits are turned off in the studio settings (autoCommit: false).";
    else if (ignored)
      reason = "The library folder is ignored by .gitignore, so nothing is committed.";
    else if (!branch) reason = "HEAD is detached; the studio commits only on a branch.";
    else {
      const busy = await busyReason(repo.root);
      if (busy) reason = `Commits wait: ${busy}.`;
    }
    return {
      git: true,
      autoCommit: on && !ignored,
      branch,
      root: repo.root,
      ...(reason ? { reason } : {}),
    };
  }

  /** Commits one showcase folder's pending changes. Resolves with
   *  { committed: true, sha, message, files } or { committed: false, reason }. */
  async function commit(showcaseDir, { message, auto = false } = {}) {
    const library = path.dirname(showcaseDir);
    const showcaseId = path.basename(showcaseDir);
    const skip = (reason) => ({ committed: false, reason });

    if (!enabled())
      return skip("Commits are turned off in the studio settings (autoCommit: false).");
    if (auto && Date.now() - (failedAt.get(showcaseDir) ?? -Infinity) < failureCooldownMs) {
      return skip("The last commit failed; waiting before trying again.");
    }
    if (!existsSync(library)) return skip("The library folder is gone.");
    const repo = await repoOf(library);
    if (!repo.root) return skip(repo.reason);
    const { root } = repo;
    const rel = path.relative(realpathSync(root), path.join(realpathSync(library), showcaseId));
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      return skip("The showcase folder isn't inside the repository.");
    }
    const spec = `:(literal)${rel.split(path.sep).join("/")}`;

    /* Only showcase folders: showcase.yaml on disk, or in git (a showcase
     * that was just deleted). */
    if (!existsSync(path.join(showcaseDir, "showcase.yaml"))) {
      const tracked = await git(["ls-files", "--", `${spec}/showcase.yaml`], root);
      if (!tracked.stdout.trim()) return skip(`"${showcaseId}" isn't a showcase folder.`);
    }

    const busy = await busyReason(root);
    if (busy) return skip(`Not committed: ${busy}.`);
    if (!(await branchOf(root))) return skip("Not committed: HEAD is detached.");

    const startedAt = new Date().toISOString();
    const changed = await git(
      ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", spec],
      root,
    );
    if (changed.code !== 0) return skip(`git status failed: ${changed.stderr.trim()}`);
    const prefix = `${rel.split(path.sep).join("/")}/`;
    const files = parseStatus(changed.stdout).map(({ code, file }) => ({
      verb: verbFor(code),
      file: file.startsWith(prefix) ? file.slice(prefix.length) : file,
    }));
    if (files.length === 0) return skip("Nothing to commit: the showcase matches the last commit.");

    const changeLog = createChangeLog(() => library, { log });
    const lastCommit = await git(["log", "-1", "--format=%ct", "--", spec], root);
    const since = Math.max(
      Number(lastCommit.stdout.trim() || 0) * 1000,
      ...changeLog
        .entries()
        .filter((e) => e.showcaseId === showcaseId && e.kind === "commit")
        .map((e) => Date.parse(e.through ?? e.at)),
    );
    const entries = changeLog
      .entries()
      .filter((e) => e.showcaseId === showcaseId && e.kind !== "commit")
      .filter((e) => Date.parse(e.at) > since);
    const text = commitMessage({ showcaseId, entries, files, message });

    const added = await git(["add", "-A", "--", spec], root);
    const done =
      added.code === 0
        ? await git(
            [
              "commit",
              "-m",
              text.subject,
              ...(text.body ? ["-m", text.body] : []),
              "-m",
              text.trailer,
              "--",
              spec,
            ],
            root,
          )
        : added;
    if (done.code !== 0) {
      failedAt.set(showcaseDir, Date.now());
      const why = (done.stderr || done.stdout).trim().split("\n").slice(-5).join("\n");
      log(`studio: couldn't commit ${showcaseId} (${why})`);
      return skip(`git commit failed: ${why}`);
    }
    failedAt.delete(showcaseDir);
    const sha = (await git(["rev-parse", "HEAD"], root)).stdout.trim();
    const names = files.map((f) => f.file);
    changeLog.append({
      source: "studio",
      showcaseId,
      kind: "commit",
      sha,
      message: text.subject,
      files: names,
      through: startedAt,
    });
    log(`studio: committed ${sha.slice(0, 7)} ${text.subject}`);
    return { committed: true, sha, message: text.subject, files: names };
  }

  const cancel = (showcaseDir) => {
    clearTimeout(pending.get(showcaseDir));
    pending.delete(showcaseDir);
  };

  return {
    status,

    /** A file changed: `file` is relative to the library. Starts (or
     *  restarts) that showcase's quiet period. Library-level files and
     *  hidden folders are not in any showcase. */
    noteChange(file) {
      if (file == null) return;
      const [first, ...rest] = String(file).split(/[/\\]/);
      if (!first || first.startsWith(".")) return;
      const showcaseDir = path.join(getLibrary(), first);
      /* A top-level file that still exists (README.md, CLAUDE.md) isn't a
       * showcase; a folder, or a name that's gone, might be. */
      if (rest.length === 0 && existsSync(showcaseDir) && !statSync(showcaseDir).isDirectory()) {
        return;
      }
      cancel(showcaseDir);
      const timer = setTimeout(() => {
        pending.delete(showcaseDir);
        void inTurn(() => commit(showcaseDir, { auto: true })).catch((error) =>
          log(`studio: couldn't commit ${first} (${error?.message ?? error})`),
        );
      }, delayMs);
      timer.unref?.();
      pending.set(showcaseDir, timer);
    },

    /** A change the studio logged for a showcase (the watcher sees the
     *  write too; this makes sure a quiet period starts either way). The
     *  studio's own commit lines are not changes. */
    noteShowcase(showcaseId, kind) {
      if (showcaseId && kind !== "commit") this.noteChange(`${showcaseId}/`);
    },

    /** commit_showcase: commits a showcase now with Claude's message. */
    commitNow(showcaseId, message) {
      const showcaseDir = path.join(getLibrary(), showcaseId);
      cancel(showcaseDir);
      return inTurn(() => commit(showcaseDir, { message }));
    },

    /** Commits whatever is still waiting for its quiet period, then stops. */
    async close() {
      const waiting = [...pending.keys()];
      waiting.forEach(cancel);
      for (const showcaseDir of waiting) {
        await inTurn(() => commit(showcaseDir, { auto: true })).catch(() => {});
      }
    },
  };
}
