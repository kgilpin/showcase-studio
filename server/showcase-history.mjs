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
 * A library outside a git repository gets one: the first time the studio
 * has something to commit, it runs `git init` there, so a new library
 * has a history from its first change instead of none at all. It never
 * does this where a repository would sweep up far more than the library
 * (a home folder, a volume root), and never inside an existing work
 * tree — that library already has a history. The setting
 * `autoCommit: false` turns commits off, including commit_showcase, and
 * turns this off with them: no commits, no repository. The user sets it with the
 * "Commit changes to git" switch in the studio (the studio server's
 * history-auto-commit action); it takes effect at once, because every
 * check reads the settings again.
 *
 * When the user has never set it, `autoCommitDefault` decides. It is off
 * in the studio Claude Code starts, and that off is narrower: it stops the
 * timer only. The session commits its own work with commit_showcase, and a
 * timer committing the same files underneath it would only make noise.
 *
 * What starts the timer is the studio's own writes — the change log, not
 * the file watcher. A change made anywhere else (an editor, a git
 * checkout or revert, another program, a Claude session's own file
 * tools) belongs to whoever made it: it never starts a commit, and only
 * rides along, named as "files changed directly", in the next commit the
 * studio makes of that showcase. */
import { execFile } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { createChangeLog } from "./change-log.mjs";
import { gitProgram } from "./git-program.mjs";

export const TRAILER = "Showcase-Studio";
const SUBJECT_LIMIT = 72;
const TURNED_OFF =
  'Commits are turned off (the studio\'s "Commit changes to git" switch, autoCommit: false in its settings).';
const AGENT_DEFAULT_OFF =
  "Automatic commits are off in the studio Claude Code starts: commit what you finish with " +
  "commit_showcase. The user can turn automatic commits on with the studio's " +
  '"Commit changes to git" switch.';

/* A folder's real, full path, for comparing it with the path git reports.
 * The native form: on Windows it expands short names like RUNNER~1 (which
 * the temp folder often has) to the long names git prints, where plain
 * realpathSync keeps them, and every showcase would look outside its
 * repository. */
const realpath = (dir) => realpathSync.native(dir);

/** git refuses to commit until it knows who is committing. Its own
 *  message is six lines of shell examples, and a user who has never used
 *  git meets it the first time the studio saves their work — so say the
 *  two commands and nothing else. */
export function noIdentityReason(stderr) {
  if (!/Please tell me who you are|unable to auto-detect email address/i.test(stderr)) {
    return undefined;
  }
  return (
    "git doesn't know who you are yet, so it can't save anything. Run these two " +
    'commands once, then the studio will keep your history: git config --global user.name "Your ' +
    'Name" and git config --global user.email "you@example.com".'
  );
}

/** Why starting a repository in this folder would be a mistake, or
 *  undefined when it's fine. A repository at a volume's root or at (or
 *  above) the home folder would take in everything the user owns, and
 *  the first `git add` would be a disaster to undo. */
export function tooBigToInit(dir, home = process.env.HOME || process.env.USERPROFILE) {
  const resolved = path.resolve(dir);
  if (resolved === path.parse(resolved).root) return "a volume's root folder";
  if (!home) return undefined;
  const homeResolved = path.resolve(home);
  if (resolved === homeResolved) return "your home folder";
  if (homeResolved.startsWith(resolved + path.sep))
    return "a folder that contains your home folder";
  return undefined;
}

/** A relative path as git spells it: forward slashes on every platform. */
const slashed = (rel) => rel.split(path.sep).join("/");

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
/** Who made a change, for the commit body. An MCP entry names the tool it
 *  came through when it wasn't edit_showcase (a saved transcript). */
const whoOf = (entry) =>
  entry.source === "mcp" && entry.tool
    ? `Claude, via ${entry.tool}`
    : (SOURCES[entry.source] ?? entry.source);

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
    case "media.tiktok":
      return edit.value ? `set ${scene} TikTok fit` : `reset ${scene} TikTok fit`;
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
    case "asset.add": {
      const files = (entry.names ?? []).map((n) => `assets/${n}`);
      return { phrases: [`add ${files.join(", ")}`], files, short: countPhrase("add", files) };
    }
    case "asset.encode":
      return {
        phrases: [`${entry.replaced ? "re-encode" : "encode"} assets/${entry.name} with ffmpeg`],
        files: [`assets/${entry.name}`],
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
    case "transcript":
      return { phrases: [`save the transcript ${entry.file}`], files: [entry.file] };
    default:
      return { phrases: [entry.kind], files: [] };
  }
}

/** What a group of files reads as when their names don't fit the
 *  subject: "add 7 graphics", "delete 6 files". One file keeps its name. */
const FOLDER_NOUNS = { assets: "assets", graphics: "graphics" };
function countPhrase(verb, files) {
  if (files.length === 1) return `${verb} ${files[0]}`;
  const folders = new Set(files.map((file) => (file.includes("/") ? file.split("/")[0] : "")));
  const noun = folders.size === 1 ? FOLDER_NOUNS[[...folders][0]] : undefined;
  return `${verb} ${files.length} ${noun ?? "files"}`;
}

/** Joins phrases into a subject no longer than SUBJECT_LIMIT, counting
 *  the phrases it had to leave out. `left` is how many were dropped. */
function fitSubject(showcaseId, phrases) {
  let subject = `${showcaseId}: ${phrases[0] ?? "update"}`;
  for (let i = 1; i < phrases.length; i += 1) {
    const rest = phrases.length - i - 1;
    const tail = rest > 0 ? `, and ${rest} more` : "";
    /* "; " between phrases that list files, which have commas of their own. */
    const joiner = phrases[i].includes(",") || phrases[i - 1].includes(",") ? "; " : ", ";
    const next = `${subject}${joiner}${phrases[i]}`;
    if ((next + tail).length > SUBJECT_LIMIT) {
      return { subject: `${subject}, and ${phrases.length - i} more`, left: phrases.length - i };
    }
    subject = next;
  }
  return { subject, left: 0 };
}

/** The commit message for one showcase's changes: a subject, a body that
 *  lists every change and who made it, and the trailer.
 *
 *    entries  change log entries since the last commit (oldest first)
 *    files    [{ verb, file }] from git status, relative to the showcase
 *    message  a message of Claude's own (commit_showcase), if any */
export function commitMessage({ showcaseId, entries = [], files = [], message }) {
  const lines = []; // [{ phrase, who, short? }]
  const explained = new Set();
  for (const entry of entries) {
    const { phrases, files: covered, short } = describeEntry(entry);
    covered.forEach((file) => explained.add(file));
    const who = whoOf(entry);
    for (const phrase of phrases) {
      if (lines.some((l) => l.phrase === phrase && l.who === who)) continue;
      lines.push({ phrase, who, ...(short && phrases.length === 1 ? { short } : {}) });
    }
  }
  const unexplained = files.filter(({ file }) => !explained.has(file));
  const byVerb = new Map();
  for (const { verb, file } of unexplained) byVerb.set(verb, [...(byVerb.get(verb) ?? []), file]);
  for (const [verb, names] of byVerb) {
    lines.push({
      phrase: `${verb} ${names.join(", ")}`,
      short: countPhrase(verb, names),
      who: "files changed directly",
    });
  }

  let subject;
  if (message) {
    subject = message.startsWith(`${showcaseId}: `) ? message : `${showcaseId}: ${message}`;
  } else {
    /* Names make the best subject, when they fit. When they don't, the
     * same changes as counts ("add 7 graphics, delete 6 files") usually
     * do — and that beats a subject that names the first group and hides
     * the rest behind "and 2 more". The body always has every name. */
    const phrases = [...new Set(lines.map((l) => l.phrase))];
    const shortOf = new Map(lines.map((l) => [l.phrase, l.short ?? l.phrase]));
    const over = (fit) => fit.subject.length > SUBJECT_LIMIT;
    let fit = fitSubject(showcaseId, phrases);
    if (fit.left > 0 || over(fit)) {
      const counted = fitSubject(
        showcaseId,
        phrases.map((phrase) => shortOf.get(phrase)),
      );
      if (over(fit) || counted.left < fit.left) fit = counted;
    }
    subject = fit.subject;
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
 *   settings            { load } — `autoCommit` turns commits on or off
 *   autoCommitDefault   what `autoCommit` means when the user has never
 *                       set it. False in the studio Claude Code starts:
 *                       that session commits its own work with
 *                       commit_showcase, and a timer committing the same
 *                       files underneath it only makes noise. The user's
 *                       own setting, either way, still wins.
 *   delayMs             the quiet period before a commit
 *   failureCooldownMs   after a failed commit (a hook said no), how long
 *                       automatic commits for that showcase wait
 *   gitPath             the git program (default: its full path, found
 *                       once by git-program.mjs)
 */
export function createShowcaseHistory({
  getLibrary,
  settings = { load: () => ({}) },
  autoCommitDefault = true,
  delayMs = 5000,
  failureCooldownMs = 60_000,
  gitPath,
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
    const result = await runGit(gitPath ?? gitProgram(), args, cwd);
    if (result.code === "ENOENT" && !gitMissing) {
      gitMissing = true;
      log("studio: git isn't installed, so showcase changes won't be committed");
    }
    return result;
  }

  /** Whether commits are on: the user's setting when they have one,
   *  else this studio's default. */
  const enabled = () => settings.load()?.autoCommit ?? autoCommitDefault;
  /** Why they are off, for status() — the two reasons read differently. */
  const offReason = () => (settings.load()?.autoCommit === false ? TURNED_OFF : AGENT_DEFAULT_OFF);

  /** Starts a repository for a library that isn't in one, so there is
   *  somewhere to keep a history. Called when the studio has a change to
   *  commit — never just because a library was opened, so looking at a
   *  library leaves nothing behind. Returns {} or { reason }. */
  async function startRepository(library) {
    const where = tooBigToInit(library);
    if (where) {
      return {
        reason:
          `This library is ${where}, and the studio won't start a git repository there. ` +
          "Move the showcases into a folder of their own, or run git init yourself.",
      };
    }
    const init = await git(["init", "-q"], library);
    if (init.code !== 0) {
      return { reason: `The studio couldn't start a git repository: ${init.stderr.trim()}` };
    }
    log(
      `studio: started a git repository in ${library} — showcase changes are committed there, ` +
        "and the switch in the studio turns that off",
    );
    return {};
  }

  /** Where the folder sits in git: { root } or { reason }. */
  async function repoOf(dir) {
    const noGit = "Git isn't installed, so the studio can't keep a history.";
    if (gitMissing) return { reason: noGit };
    const top = await git(["rev-parse", "--show-toplevel"], dir);
    if (top.code === "ENOENT") return { reason: noGit };
    if (top.code !== 0) {
      return {
        notRepo: true,
        reason:
          "This library isn't in a git repository, so the studio keeps no history. " +
          `Run git init in ${dir} to turn on history.`,
      };
    }
    return { root: top.stdout.trim() };
  }

  /** Why git is busy right now (a merge, a rebase, …), or undefined. */
  async function busyReason(root) {
    const args = ["rev-parse", ...BUSY_MARKERS.flatMap(([name]) => ["--git-path", name])];
    const result = await git(args, root);
    if (result.code !== 0) return "git couldn't be read";
    const paths = result.stdout.trim().split(/\r?\n/);
    const hit = BUSY_MARKERS.find((_, i) => paths[i] && existsSync(path.resolve(root, paths[i])));
    return hit ? `${hit[1]} is in progress` : undefined;
  }

  async function branchOf(root) {
    const result = await git(["symbolic-ref", "-q", "--short", "HEAD"], root);
    return result.code === 0 ? result.stdout.trim() : null;
  }

  /** The history facts for studio_info, studio_start and the studio's
   *  "Commit changes to git" switch:
   *
   *    git         the library is in a git work tree (and git is installed)
   *    autoCommit  changes are being committed: switched on, and the
   *                library isn't ignored by .gitignore
   *    enabled     the user's choice: the switch (autoCommit in settings)
   *    available   commits are possible here at all: git, a repository,
   *                and a library .gitignore doesn't hide
   *    branch      the current branch, or null
   *    root        the repository's top folder
   *    reason      why commits are off, impossible, or waiting */
  async function status() {
    const library = getLibrary();
    const on = enabled();
    const none = (reason) => ({
      git: false,
      autoCommit: false,
      enabled: on,
      available: false,
      branch: null,
      reason,
    });
    if (!existsSync(library)) return none("The library folder is gone.");
    const repo = await repoOf(library);
    if (repo.notRepo && on && !tooBigToInit(library)) {
      return none(
        "This library isn't in a git repository yet. The studio starts one the first time " +
          "it commits a change, so your work can be reviewed and undone.",
      );
    }
    if (!repo.root) return none(repo.reason);
    const branch = await branchOf(repo.root);
    const relLibrary = path.relative(realpath(repo.root), realpath(library));
    const ignored =
      relLibrary !== "" &&
      (await git(["check-ignore", "-q", `${slashed(relLibrary)}/`], repo.root)).code === 0;
    let reason;
    if (ignored) reason = "The library folder is ignored by .gitignore, so nothing is committed.";
    else if (!on) reason = offReason();
    else if (!branch) reason = "HEAD is detached; the studio commits only on a branch.";
    else {
      const busy = await busyReason(repo.root);
      if (busy) reason = `Commits wait: ${busy}.`;
    }
    return {
      git: true,
      autoCommit: on && !ignored,
      enabled: on,
      available: !ignored,
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

    /* Two different "off"s. The user's switch means "keep the studio out
     * of my git" and stops every commit, commit_showcase included. The
     * default in the studio Claude Code starts only stops the timer: the
     * session still commits its own work with commit_showcase. */
    if (settings.load()?.autoCommit === false) return skip(TURNED_OFF);
    if (auto && !enabled()) return skip(AGENT_DEFAULT_OFF);
    if (auto && Date.now() - (failedAt.get(showcaseDir) ?? -Infinity) < failureCooldownMs) {
      return skip("The last commit failed; waiting before trying again.");
    }
    if (!existsSync(library)) return skip("The library folder is gone.");
    let repo = await repoOf(library);
    /* No repository yet: make one, rather than throw the change away.
     * Commits being off has already returned above, so this only ever
     * happens for a user who is having their work committed. */
    if (repo.notRepo) {
      const started = await startRepository(library);
      if (started.reason) return skip(started.reason);
      repo = await repoOf(library);
    }
    if (!repo.root) return skip(repo.reason);
    const { root } = repo;
    const rel = path.relative(realpath(root), path.join(realpath(library), showcaseId));
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      return skip("The showcase folder isn't inside the repository.");
    }
    const spec = `:(literal)${slashed(rel)}`;

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
    const prefix = `${slashed(rel)}/`;
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
      return skip(noIdentityReason(why) ?? `git commit failed: ${why}`);
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

    /** Drops every commit still waiting for its quiet period, without
     *  committing. The studio calls it when the user turns commits off. */
    cancelPending() {
      [...pending.keys()].forEach(cancel);
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
      /* A commit already running (a git process holding the folder open)
       * finishes before close resolves, so the caller can remove the
       * folder — which Windows refuses while git has it. */
      await queue;
    },
  };
}
