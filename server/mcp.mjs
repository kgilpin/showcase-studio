/* The studio's MCP tools — how Claude drives the studio. Served as
 * streamable HTTP at /mcp by the studio server (a plain JSON-RPC handler,
 * no SDK) for the Claude terminals the studio opens, and over stdio by
 * scripts/studio-mcp.mjs, the studio Claude Code starts for itself, which
 * runs them in-process through the studio's callTool.
 *
 * Page tools (screenshot_slide, validate, export) render through the
 * studio's page renderer, so they see the current files on disk — the
 * same files Claude just edited. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pageErrorField } from "../src/lib/page-error.mjs";
import { EXPORT_KINDS } from "./launch-options.mjs";
import { addAssetPaths } from "./asset-files.mjs";
import { applySceneEditsToFolder, contentHash } from "./scene-edit.mjs";
import { screenshotSlide, scriptText, validateShowcases } from "./exporter.mjs";
import { showcaseIndex } from "./showcase-data.mjs";
import { transcribe } from "./transcribe.mjs";

const PROTOCOL_VERSIONS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);

export const TOOLS = [
  {
    name: "studio_info",
    description:
      "The running studio: its URL (open it to see the studio — in a Claude Code preview, " +
      "open this URL), the library folder, the showcases in it, and the lock (the one " +
      "showcase the studio is locked to, if any). Call it first to find the studio. " +
      "`history` says whether the studio keeps a git history of the library: " +
      "{git, autoCommit, enabled, available, branch, reason?} — reason explains why commits " +
      "are off or waiting. enabled is the user's own switch in the studio; don't change it. " +
      "`pageError` {message, stack, path, at} appears when the last studio page failed to " +
      "render on the server and no page has rendered since: tell the user that error.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "screenshot_slide",
    description:
      "Render one slide of a showcase and return it as an image — see exactly how the slide " +
      "looks (App Screens presentation, media and diagrams fully revealed). Use it after " +
      "editing a slide, theme, or TSX graphic to check your work.",
    inputSchema: {
      type: "object",
      properties: {
        showcaseId: { type: "string", description: "The showcase's folder name" },
        sceneId: { type: "string", description: "The scene id from showcase.yaml" },
      },
      required: ["showcaseId", "sceneId"],
    },
  },
  {
    name: "edit_showcase",
    description:
      "Apply structured edits to a showcase.yaml — the same comment-preserving write path as " +
      "in-app editing. Use this instead of hand-editing, sed, or scripts for changes it can " +
      "express: every comment, blank line, and quote style elsewhere in the file survives, " +
      "values are validated, and a bad edit is refused with the reason. The edits apply in " +
      "order (later edits see earlier ones — an insert shifts the indexes after it) and land " +
      "as ONE write; if any edit fails, nothing is written. Each edit is an object with " +
      "`field` plus its parameters:\n" +
      '- {field: "scene.set", sceneId, name, value} — one scene field: title, eyebrow, theme, ' +
      "support, ctaNote, captionStyle, transition, durationMs, export, id, note (the scene's " +
      "authoring note — keep working context here, not in YAML comments), cta " +
      "({label, url, kind?}), or watermark (false opts this slide out of the showcase's brand " +
      "mark, true forces it on, a map overrides a field or two for this slide — an empty " +
      'asset or text ("") drops the image or the wordmark there), or tiktok ({fit?, focus?, ' +
      "bands?} — written to media.tiktok: how the scene's picture goes into TikTok's 9:16 " +
      "frame; fit fill|fit, focus top|center|bottom|<n>%, bands blur|color). null removes " +
      "an optional field.\n" +
      '- {field: "caption.set", sceneId, captionIndex, name, value} — a caption\'s text, ' +
      "durationMs, or position (top|center|lower|bottom — each format places these at its " +
      "own height, clear of TikTok's interface in the TikTok video — or an exact height " +
      'like "14%": the caption\'s top edge that far down, in every format).\n' +
      '- {field: "caption.insert", sceneId, captionIndex, caption: {text, ...}} and ' +
      '{field: "caption.delete", sceneId, captionIndex}\n' +
      '- {field: "scene.insert", index, scene: {id, theme, captions, media, ...}}, ' +
      '{field: "scene.delete", sceneId}, and {field: "scene.move", sceneId, index}\n' +
      '- {field: "meta.set", name, value} — meta title, description, loop, pace, captionStyle, ' +
      "embedCaptions (true/false: overlay captions in the 4:3 embed; null returns to the " +
      "default, which hides them when a synced voiceover is set), cover, notes " +
      "(showcase-level authoring notes), soundtrack ({src, volume?, sync?}), tiktok ({fit?, " +
      "focus?, bands?} — how every scene's picture goes into TikTok's 9:16 frame), or watermark " +
      "({asset?, text?, position?, opacity?, scale?}) — the brand mark drawn in a corner of " +
      "every slide, like a TV network's bug. position is one of the four corners " +
      "(top-left default); opacity defaults to 0.85. Use an identity mark (a logo, a " +
      "wordmark), not the App Store badge — that is a call to action and belongs in a " +
      "scene's cta.\n" +
      '- {field: "media.set", sceneId, media} — replace the scene\'s whole media mapping; ' +
      '{field: "media.asset", sceneId, value} just points it at another asset.\n' +
      "The studio's pages reload on the write; run validate or screenshot_slide to check the " +
      "result. theme.yaml and comments are not covered — edit those directly.\n" +
      "Returns {applied, version}. Pass ifVersion — the version read_showcase or your last " +
      "edit_showcase returned — so an edit the user made in the studio meanwhile is never " +
      "overwritten unseen: when showcase.yaml has changed since that version, nothing is " +
      "written and the error lists the changes the studio logged since then.",
    inputSchema: {
      type: "object",
      properties: {
        showcaseId: { type: "string", description: "The showcase's folder name" },
        edits: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: { field: { type: "string" } },
            required: ["field"],
          },
          description: "The edits, applied in order as one write (see the tool description)",
        },
        ifVersion: {
          type: "string",
          description:
            "The showcase.yaml version these edits were made against (from read_showcase or " +
            "the last edit_showcase result). The write is refused if the file changed since.",
        },
      },
      required: ["showcaseId", "edits"],
    },
  },
  {
    name: "read_showcase",
    description:
      "Read a showcase's showcase.yaml as it is on disk now, with its version (a content " +
      "hash). Pass the version to edit_showcase as ifVersion. Also returns the path of the " +
      "studio's change log, where every edit made in the studio lands as one JSON line.",
    inputSchema: {
      type: "object",
      properties: {
        showcaseId: { type: "string", description: "The showcase's folder name" },
      },
      required: ["showcaseId"],
    },
  },
  {
    name: "add_asset",
    description:
      "Put files into a showcase's assets/ folder, from paths on this machine. Use it for " +
      "an image or video the user dropped into the chat (Claude Code writes those to a file " +
      "and gives you its path), and for anything you captured yourself, such as a screenshot " +
      "of the user's app. Returns each asset's key — the name without its extension — which " +
      "is what a scene's media refers to. A name already taken is never overwritten: the " +
      "copy becomes shot-2.png beside shot.png, and the result says so. Diagrams and " +
      "explainers don't belong here: write those as TSX graphics (the guide says how).",
    inputSchema: {
      type: "object",
      properties: {
        showcaseId: { type: "string", description: "The showcase's folder name" },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "The file to copy in, on this machine" },
              name: {
                type: "string",
                description:
                  "What to call it in assets/ (default: the file's own name). Name it for " +
                  "what it shows — the key comes from this.",
              },
            },
            required: ["path"],
          },
          description: "The files to add",
        },
      },
      required: ["showcaseId", "files"],
    },
  },
  {
    name: "commit_showcase",
    description:
      "Commit a showcase's changes to git now, with your own message. In the studio Claude " +
      "Code starts, the studio makes no commits on its own — this is how your work gets " +
      "committed, including files you wrote with your own tools (a TSX graphic, " +
      "theme.yaml). Elsewhere the studio commits its own writes a few seconds after they " +
      "stop. Either way, call this after you finish a meaningful step, to give it a clear " +
      'name ("Retime scenes to the new voiceover"), and before you run git commands ' +
      "yourself. Only the showcase's folder " +
      "is committed — other staged or unstaged work in the repository is left as it is. The " +
      'subject becomes "<showcaseId>: <message>". Returns {committed: true, sha, message, ' +
      "files}, or {committed: false, reason} when there was nothing to commit or git isn't " +
      "ready (not a repository, a merge in progress, a detached HEAD, commits turned off).",
    inputSchema: {
      type: "object",
      properties: {
        showcaseId: { type: "string", description: "The showcase's folder name" },
        message: {
          type: "string",
          description: "What this step did, in plain words (the commit subject)",
        },
      },
      required: ["showcaseId", "message"],
    },
  },
  {
    name: "validate",
    description:
      "Parse and build every showcase in the library exactly as the app does. Returns the " +
      "showcases that loaded (id, title, slides, runtime), theme-linter warnings (per scene), " +
      "and, for any showcase that failed, the error message. Use it after YAML edits to " +
      "confirm nothing broke.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "transcribe",
    description:
      "Voice-to-text with timestamps: transcribe an audio or video file (whisper.cpp, run " +
      "locally). Returns sentence segments with per-word timestamps in milliseconds — whole " +
      "words, so they match caption words one for one. Use it to find what a recording says " +
      "and when: choosing cut points for a take, or checking a line — silencedetect only finds " +
      "pauses, this finds the words. First use downloads the speech model (~142MB), so the " +
      "first call can take a minute.\n" +
      "Pass save: true to also write the recording's editable transcript beside it " +
      "(assets/<recording>.transcript.json). That file is what build_media turns into the " +
      "showcase's karaoke words file, and it is where a mishearing gets fixed: add to its " +
      "`corrections` list — {at, text} respells the word starting at that millisecond, " +
      "{at, text, through} folds the words up to `through` into one, {at, start, end} moves a " +
      "word whisper placed early. Corrections are re-applied after every re-transcribe, and " +
      "so is a word you respell in the file itself, so nothing is lost by transcribing again.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description:
            "The recording: an absolute path, or a path relative to the showcases library " +
            "root or to any showcase folder (e.g. nova/assets/voiceover.mp3 " +
            "or assets/voiceover.mp3)",
        },
        save: {
          type: "boolean",
          description:
            "Write the recording's editable transcript beside it, keeping the corrections an " +
            "existing one carries",
        },
      },
      required: ["file"],
    },
  },
  {
    name: "build_media",
    description:
      "Build a recorded pitch's media from its cut list — the voiceover, one muted clip per " +
      "footage scene, the karaoke words file, and every scene's durationMs. Returns a jobId " +
      "immediately; poll build_status.\n" +
      "The cut list lives in showcase.yaml: meta.source names the master recording " +
      "({video, speed}), and each scene's `take` names the span of it that scene owns " +
      "({from, to} in seconds; {silence: <seconds>} for a card with nothing spoken over it; a " +
      "list of spans to drop a pause; {audio: [...], video: [...]} when the picture " +
      "fast-forwards a pause the sound cuts out). Everything else is derived, so the picture " +
      "and the voice cannot drift apart — never pin durationMs by hand on a built showcase, " +
      "and never cut clips with your own ffmpeg calls or a script.\n" +
      "Builds are idempotent: only outputs whose inputs changed are rebuilt. `force` rebuilds " +
      "everything; `only` limits it to those scene ids.",
    inputSchema: {
      type: "object",
      properties: {
        showcaseId: { type: "string", description: "The showcase's folder name" },
        force: {
          type: "boolean",
          description: "Rebuild every output, even the ones whose inputs are unchanged",
        },
        only: {
          type: "array",
          items: { type: "string" },
          description: "Build only these scenes' clips (the voiceover is built when listed too)",
        },
      },
      required: ["showcaseId"],
    },
  },
  {
    name: "build_status",
    description:
      "Check on a build_media job: status (running | done | failed | canceled), what it is " +
      "doing now, and when it is done, what it built, what it left alone, the pins it wrote, " +
      "and any notes worth telling the user.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "build_cancel",
    description: "Cancel a running build_media job.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "script",
    description:
      "The showcase's narration script as share-ready plain text: a title header, the " +
      "description, then one block per scene — '--- Scene N · theme · eyebrow · title' over the " +
      "indented spoken lines (captions and support, read verbatim in order).",
    inputSchema: {
      type: "object",
      properties: {
        showcaseId: { type: "string", description: "The showcase's folder name" },
      },
      required: ["showcaseId"],
    },
  },
  {
    name: "export",
    description:
      "Start an export of a showcase as a background job — returns a jobId immediately; poll " +
      'export_status (you can keep working meanwhile). Kinds: "video-draft" renders a fast, ' +
      "small MP4 (12fps, half size) — use it freely to check your work while iterating; " +
      '"video" is the full-quality 1080×1920 (9:16) TikTok render and takes minutes — confirm with the user ' +
      'before starting one; "video-43" / "video-43-draft" render the 4:3 embed canvas ' +
      "(1440×1080, for YouTube and desktop embeds — feature and footage scenes show text " +
      'beside the media); "screens" captures the App Store screenshot set; "script" ' +
      "writes the narration as <id>_script.txt (instant). Output lands in " +
      "~/Downloads/showcase-exports/<id>, named <id>[_43][_draft].mp4 (screenshots in " +
      "screens/); the previous export is kept numbered (<id>_draft.1.mp4, screens.1/). One " +
      "export runs at a time, shared with the studio's Export button.",
    inputSchema: {
      type: "object",
      properties: {
        showcaseId: { type: "string", description: "The showcase's folder name" },
        kind: { type: "string", enum: EXPORT_KINDS },
      },
      required: ["showcaseId", "kind"],
    },
  },
  {
    name: "export_status",
    description:
      "Check on an export job: status (running | done | failed | canceled), the current " +
      "progress label, and the output path once done.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "export_cancel",
    description: "Cancel a running export job.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
];

/** Resolves a tool-supplied file path against the library layout. */
function resolveAudio(file, showcasesDir) {
  if (path.isAbsolute(file)) return existsSync(file) ? file : undefined;
  const direct = path.join(showcasesDir, file);
  if (existsSync(direct)) return direct;
  for (const entry of readdirSync(showcasesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(showcasesDir, entry.name, file);
    if (existsSync(nested)) return nested;
  }
  return undefined;
}

/* Transcription outlives the page-tool cap: a cold call downloads the
 * model and a long recording takes real time. */
const TRANSCRIBE_TIMEOUT_MS = 300_000;

const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

/** The refusal for an edit made against an old version: what the change
 *  log recorded since that version, one JSON line per write. */
function staleEditMessage(changeLog, showcaseId, ifVersion, currentVersion) {
  const { known, entries } = changeLog?.since(showcaseId, "showcase.yaml", ifVersion) ?? {
    known: false,
    entries: [],
  };
  const lastVersion = entries.findLast((e) => e.file === "showcase.yaml")?.version;
  const lines = [`showcase.yaml changed since version ${ifVersion} — nothing was written.`];
  if (!known) {
    lines.push(
      "The change log has no record of that version: the file was changed outside the studio " +
        "(a hand edit, git) or longer ago than the log keeps." +
        (entries.length ? " The showcase's latest logged changes:" : ""),
    );
  } else if (entries.length === 0) {
    lines.push("The studio logged no changes since then: the file was changed outside the studio.");
  } else {
    lines.push("The studio logged these changes since then, oldest first:");
  }
  lines.push(...entries.map((entry) => JSON.stringify(entry)));
  if (known && entries.length > 0 && lastVersion !== currentVersion) {
    lines.push("The file was also changed outside the studio after the last of these.");
  }
  lines.push(
    `The current version is ${currentVersion}. Read the showcase again (read_showcase), ` +
      "check your edits against it, and retry with the new version as ifVersion.",
  );
  return lines.join("\n");
}

/** Runs one tool against a studio. `context` is
 *  { info(), getUrl(), getShowcasesDir(), renderer, exportJobs, buildJobs,
 *  changeLog, history }. */
export async function callTool(context, { name, arguments: args = {} } = {}) {
  const showcasesDir = context.getShowcasesDir();
  if (name === "studio_info") {
    return json({
      ...context.info(),
      showcases: showcaseIndex(showcasesDir).showcases.map((s) => s.id),
      changes: context.changeLog?.path(),
      ...(context.history ? { history: await context.history.status() } : {}),
      ...pageErrorField(),
    });
  }
  if (name === "commit_showcase") {
    const showcaseId = String(args.showcaseId ?? "");
    if (!showcaseId || /[/\\]|\.\./.test(showcaseId) || showcaseId.startsWith(".")) {
      throw new Error("Bad showcase id");
    }
    const message = String(args.message ?? "").trim();
    if (!message) throw new Error("Give the commit a message");
    if (!context.history) throw new Error("This studio keeps no history");
    return json(await context.history.commitNow(showcaseId, message));
  }
  if (name === "read_showcase") {
    const showcaseId = String(args.showcaseId ?? "");
    if (!showcaseId || /[/\\]|\.\./.test(showcaseId)) throw new Error("Bad showcase id");
    const file = path.join(showcasesDir, showcaseId, "showcase.yaml");
    if (!existsSync(file)) throw new Error(`No showcase named "${showcaseId}"`);
    const text = readFileSync(file, "utf8");
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            showcaseId,
            version: contentHash(text),
            changes: context.changeLog?.path(),
          }),
        },
        { type: "text", text },
      ],
    };
  }
  if (name === "add_asset") {
    const showcaseId = String(args.showcaseId ?? "");
    const result = addAssetPaths(showcasesDir, { showcaseId, files: args.files });
    if (!result.ok) throw new Error(result.error);
    context.changeLog?.append({
      source: "mcp",
      showcaseId,
      kind: "asset.add",
      names: result.assets.map((asset) => asset.name),
    });
    return json({ showcaseId, assets: result.assets });
  }
  if (name === "edit_showcase") {
    const showcaseId = String(args.showcaseId ?? "");
    const result = applySceneEditsToFolder(showcasesDir, {
      showcaseId: args.showcaseId,
      edits: args.edits,
      baseHash: args.ifVersion,
    });
    if (result.stale) {
      throw new Error(staleEditMessage(context.changeLog, showcaseId, args.ifVersion, result.hash));
    }
    if (!result.ok) throw new Error(result.error);
    context.changeLog?.append({
      source: "mcp",
      showcaseId,
      kind: "edit",
      file: "showcase.yaml",
      previousVersion: result.previousHash,
      version: result.hash,
      edits: args.edits,
    });
    return json({ applied: result.applied, version: result.hash });
  }
  if (name === "script") {
    return {
      content: [{ type: "text", text: scriptText(showcasesDir, String(args.showcaseId ?? "")) }],
    };
  }
  if (name === "build_media") {
    return json(
      context.buildJobs.start("build", String(args.showcaseId ?? ""), {
        force: args.force === true,
        only: Array.isArray(args.only) ? args.only.map(String) : undefined,
      }),
    );
  }
  if (name === "build_status" || name === "build_cancel") {
    const jobId = String(args.jobId ?? "");
    const result =
      name === "build_cancel" ? context.buildJobs.cancel(jobId) : context.buildJobs.status(jobId);
    if (!result) throw new Error(`No build job named "${jobId}"`);
    return json(result);
  }
  if (name === "export") {
    const kind = String(args.kind ?? "");
    if (!EXPORT_KINDS.includes(kind)) {
      throw new Error(`Unknown export kind "${kind}" — use one of: ${EXPORT_KINDS.join(", ")}`);
    }
    return json(context.exportJobs.start(kind, String(args.showcaseId ?? "")));
  }
  if (name === "export_status" || name === "export_cancel") {
    const jobId = String(args.jobId ?? "");
    const result =
      name === "export_cancel"
        ? context.exportJobs.cancel(jobId)
        : context.exportJobs.status(jobId);
    if (!result) throw new Error(`No export job named "${jobId}"`);
    return json(result);
  }
  if (name === "transcribe") {
    const file = String(args.file ?? "");
    const audioPath = file && resolveAudio(file, showcasesDir);
    if (!audioPath) {
      throw new Error(
        `No file named "${file}" found (looked in the library root and each showcase folder; ` +
          `absolute paths work too).`,
      );
    }
    let timer;
    const result = await Promise.race([
      transcribe(audioPath, {
        save: args.save === true,
        progress: (label) => console.log(`transcribe: ${label}`),
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Transcription timed out after 5 minutes")),
          TRANSCRIBE_TIMEOUT_MS,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    /* A saved transcript is a file the studio wrote into a showcase, so
     * it goes in the change log like any other studio write — that is
     * what lets the history commit it (server/showcase-history.mjs). A
     * recording at the library root or outside it belongs to no
     * showcase, and is left to its owner. */
    const saved = result.transcript?.file;
    const rel = saved ? path.relative(showcasesDir, saved) : "";
    const inLibrary = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    const [showcaseId, ...rest] = inLibrary ? rel.split(/[/\\]/) : [];
    if (showcaseId && rest.length > 0) {
      context.changeLog?.append({
        source: "mcp",
        tool: "transcribe",
        showcaseId,
        kind: "transcript",
        file: rest.join("/"),
      });
    }
    return json({ file: audioPath, ...result });
  }
  if (name === "screenshot_slide") {
    const data = await screenshotSlide(context.renderer, context.getUrl(), args);
    return {
      content: [
        { type: "image", data, mimeType: "image/png" },
        {
          type: "text",
          text: `Slide "${args.sceneId}" of "${args.showcaseId}" — App Screens presentation, media fully revealed.`,
        },
      ],
    };
  }
  if (name === "validate") {
    const report = await validateShowcases(context.renderer, context.getUrl());
    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}

/** The JSON-RPC side of MCP: answers one message, or returns undefined
 *  for a notification. `callTool(params)` runs a tool and returns its
 *  result; a thrown error becomes a tool error Claude can read. `tools`
 *  is the tool list to offer. */
export function createMcpRpc({ version, callTool: runTool, tools = TOOLS }) {
  return async (message) => {
    const { id, method, params } = message ?? {};
    if (id === undefined) return undefined;
    const respond = (result) => ({ jsonrpc: "2.0", id, result });
    switch (method) {
      case "initialize":
        return respond({
          protocolVersion: PROTOCOL_VERSIONS.has(params?.protocolVersion)
            ? params.protocolVersion
            : "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "showcase-studio", version },
        });
      case "ping":
        return respond({});
      case "tools/list":
        return respond({ tools });
      case "tools/call":
        try {
          return respond(await runTool(params));
        } catch (error) {
          return respond({
            content: [{ type: "text", text: String(error?.message ?? error) }],
            isError: true,
          });
        }
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  };
}

/** The /mcp request handler for a studio (see callTool for `context`). */
export function createMcpHandler({ version, context }) {
  const rpc = createMcpRpc({ version, callTool: (params) => callTool(context, params) });
  return async (req, res) => {
    if (req.method !== "POST") {
      // No server-push stream, no sessions — POST only.
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    let message;
    try {
      message = JSON.parse(body);
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        }),
      );
      return;
    }
    const reply = await rpc(message);
    if (!reply) {
      // A notification (e.g. notifications/initialized) — no reply body.
      res.statusCode = 202;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(reply));
  };
}
