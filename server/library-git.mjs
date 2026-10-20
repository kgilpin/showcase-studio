/* Where a library sits in git — the facts behind offering a worktree when
 * another studio already has the library open (server/mcp-stdio.mjs).
 *
 * A worktree is a second copy of the repository, made from its last
 * commit. So it has the library only when git has it, and it leaves two
 * kinds of file behind, which the offer has to name up front:
 *
 *   not in git     untracked or ignored files — large recordings are
 *                  often kept out of git on purpose, and the worktree's
 *                  slides would show them as missing
 *   uncommitted    changes to tracked files not committed yet — perhaps
 *                  the other session's work in progress */
import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { gitProgram } from "./git-program.mjs";

const SHOWN = 10; // file names listed per kind; the counts cover the rest

function git(args, cwd, gitPath) {
  return new Promise((resolve) => {
    execFile(gitPath, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) =>
      resolve({ ok: !error, stdout: String(stdout ?? "") }),
    );
  });
}

const real = (dir) => {
  try {
    return realpathSync.native(dir);
  } catch {
    return path.resolve(dir);
  }
};

/* The studio's own state, the OS's litter, and Claude Code's worktrees
 * are not part of the showcases — a worktree doesn't need them. */
const OWN = /(^|\/)(\.studio|\.claude)(\/|$)|(^|\/)\.DS_Store$/;

/** `{ root, library, notInGit, uncommitted }`, or null when a worktree
 *  can't carry the library: it isn't in a git work tree, git is missing,
 *  or git ignores the library folder itself.
 *
 *    root         the repository's top folder
 *    library      the library's folder inside it ("" when it is the top)
 *    notInGit     { count, bytes, files } — untracked or ignored files
 *    uncommitted  { count, files } — tracked files with uncommitted changes
 *  Both count only files inside a showcase's folder. Paths in `files` are
 *  relative to the library. */
export async function libraryInGit(library, { gitPath = gitProgram() } = {}) {
  const top = await git(["rev-parse", "--show-toplevel"], library, gitPath);
  if (!top.ok) return null;
  const root = top.stdout.trim();
  const rel = path.relative(real(root), real(library)).split(path.sep).join("/");
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  if (rel !== "" && (await git(["check-ignore", "-q", "--", `${rel}/`], root, gitPath)).ok) {
    return null;
  }

  const status = await git(
    [
      "status",
      "--porcelain=v1",
      "-z",
      "--ignored",
      "--untracked-files=all",
      "--",
      rel === "" ? "." : `:(literal)${rel}`,
    ],
    root,
    gitPath,
  );
  const notInGit = { count: 0, bytes: 0, files: [] };
  const uncommitted = { count: 0, files: [] };
  const entries = status.stdout.split("\0");
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const file = entry.slice(3);
    /* A rename or copy is followed by its old path, as its own entry. */
    if (code[0] === "R" || code[0] === "C") i += 1;
    /* A nested repository (another worktree, say) shows as one folder. */
    if (file.endsWith("/")) continue;
    const inLibrary = rel === "" ? file : file.slice(rel.length + 1);
    if (OWN.test(inLibrary)) continue;
    /* Only what's inside a showcase counts: the files at the library's top
     * (README.md, CLAUDE.md, .gitignore) are ones the studio writes into
     * any copy it opens. */
    if (!inLibrary.includes("/")) continue;
    if (code === "??" || code === "!!") {
      notInGit.count += 1;
      try {
        notInGit.bytes += statSync(path.join(root, file)).size;
      } catch {
        /* Gone since git looked: count it, size unknown. */
      }
      if (notInGit.files.length < SHOWN) notInGit.files.push(inLibrary);
    } else {
      uncommitted.count += 1;
      if (uncommitted.files.length < SHOWN) uncommitted.files.push(inLibrary);
    }
  }
  return { root, library: rel, notInGit, uncommitted };
}
