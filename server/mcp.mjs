/* The studio's MCP tools — how Claude drives the studio. Served as
 * streamable HTTP at /mcp by the studio server (a plain JSON-RPC handler,
 * no SDK) for the Claude terminals the studio opens, and over stdio by
 * scripts/studio-mcp.mjs, the studio Claude Code starts for itself, which
 * runs them in-process through the studio's callTool.
 *
 * Page tools (screenshot_slide, screenshot_frame, check_framing, validate, export) render through the
 * studio's page renderer, so they see the current files on disk — the
 * same files Claude just edited. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pageErrorField } from "../src/lib/page-error.mjs";
import { EXPORT_KINDS } from "./launch-options.mjs";
import { addAssetPaths, encodeAsset } from "./asset-files.mjs";
import { applySceneEditsToFolder, contentHash } from "./scene-edit.mjs";
import {
  formatClock,
  MAX_FRAMES_PER_CALL,
  screenshotFrame,
  screenshotSlide,
  scriptText,
  validateShowcases,
} from "./exporter.mjs";
import { showcaseIndex } from "./showcase-data.mjs";
import { transcribe } from "./transcribe.mjs";
import { createFaceFinder } from "./faces.mjs";
import { checkCaptionsOverFaces, facesSummary } from "./face-check.mjs";
import { DESTINATION_IDS, DESTINATIONS } from "../src/content/publish-rules.mjs";

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
      "`actions` is the studio's Actions list — every export, media build and git commit, " +
      "whoever started it: {pending, running, failed: [{id, kind, label, showcaseId, by, " +
      "error}], path}. A failure listed there is one the user has seen in the studio and " +
      "hasn't dismissed; `path` is the list's file (.studio/actions.jsonl, one line per " +
      "state change) to follow with tail -F. " +
      "`pageError` {message, stack, path, at} appears when the last studio page failed to " +
      "render on the server and no page has rendered since: tell the user that error. " +
      "`media` lists every showcase whose media the studio builds (a recorded pitch, a " +
      "voiced showcase) with whether it is up to date: {showcaseId, kind, upToDate, stale: " +
      "[what a build would remake], problem?: why it can't be built yet}; `autoBuild` says " +
      "whether the studio builds on its own when inputs change (the user's switch).",
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
    name: "screenshot_frame",
    description:
      "Render one frame of the video at a given time and return it as an image: the page the " +
      "video export records, so the frame shows what the exported video shows at that moment " +
      "— overlay captions, the picture's TikTok fit, the brand mark. Use it to answer \"at " +
      'time T, is X right?" (a caption over a face, a cut landing on a word, a graphic clear ' +
      "of the caption rows) instead of rendering a draft and scrubbing it. Free, like " +
      "screenshot_slide. atMs is a time in milliseconds from the start of the video, or a list " +
      `of up to ${MAX_FRAMES_PER_CALL} (one image each, in that order); under each image a ` +
      'line names the scene and the caption showing then. view: "tiktok" (default, the 9:16 ' +
      'frame) or "43" (the 4:3 embed). Animations are moved to their end by default — the ' +
      'still of the frame, as the screens export shows a slide; animations: "live" leaves ' +
      "them where the clock has them at that moment, to check a mark's timing. safeArea: " +
      "true shades where TikTok's tabs, buttons and description cover the frame (TikTok view), " +
      "as the player's Safe area switch does. Frames come at half size (540×960, or 720×540 " +
      'for 4:3); size: "full" renders them at 1080×1920 / 1440×1080.',
    inputSchema: {
      type: "object",
      properties: {
        showcaseId: { type: "string", description: "The showcase's folder name" },
        atMs: {
          description: "A time in ms from the start of the video, or a list of them",
          anyOf: [{ type: "number" }, { type: "array", items: { type: "number" }, minItems: 1 }],
        },
        view: { type: "string", enum: ["tiktok", "43"] },
        animations: { type: "string", enum: ["finished", "live"] },
        safeArea: { type: "boolean" },
        size: { type: "string", enum: ["half", "full"] },
      },
      required: ["showcaseId", "atMs"],
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
      "support, ctaNote, captionStyle, transition, durationMs (a new value re-scales the " +
      "captions' own durationMs by the same ratio, so they still add up; scaleCaptions: " +
      "false on the edit leaves them), maxMs (the longest this scene should run — overrides " +
      "meta.sceneMaxMs), speed (a video clip's playing rate, 0.25–4, written to " +
      "media.speed: the player and every export play the clip that fast, so a scene's " +
      "natural length is clip length ÷ speed — the fix for a long screen recording), " +
      "export, id, take (on a recorded " +
      "pitch, the span of the recording the scene owns: {from, to} in seconds, a list of them, " +
      "{silence: <seconds>}, or {audio: [...], video: [...]} lasting the same; plus clip: " +
      "true|false — then run build_media), note (the scene's " +
      "authoring note — keep working context here, not in YAML comments), cta " +
      "({label, url, kind?}), or watermark (false opts this slide out of the showcase's brand " +
      "mark, true forces it on, a map overrides a field or two for this slide — an empty " +
      'asset or text ("") drops the image or the wordmark there), or tiktok ({fit?, focus?, ' +
      "bands?, area?} — written to media.tiktok: how the scene's picture goes into TikTok's " +
      "9:16 frame; fit fill|fit, focus top|center|bottom|<n>%, bands blur|color, area " +
      "{top?, right?, bottom?, left?} insets in % of the frame). null removes " +
      "an optional field.\n" +
      '- {field: "caption.set", sceneId, captionIndex, name, value} — a caption\'s text, ' +
      "durationMs, or position (top|center|lower|bottom — each format places these at its " +
      "own height, clear of TikTok's interface in the TikTok video — or an exact height " +
      'like "14%": the caption\'s top edge that far down, in every format).\n' +
      '- {field: "caption.insert", sceneId, captionIndex, caption: {text, ...}} and ' +
      '{field: "caption.delete", sceneId, captionIndex}\n' +
      '- {field: "scene.insert", index, scene: {id, theme, captions, media, ...}}, ' +
      '{field: "scene.delete", sceneId}, and {field: "scene.move", sceneId, index}\n' +
      '- {field: "meta.set", name, value} — meta title, description, loop, pace, sceneMaxMs ' +
      "(the longest any scene should run, in ms: validate and the player warn about each " +
      "scene over it, saying why it is long), targetMs (what the whole video should add up " +
      "to, in ms: a warning names the longest scenes when it runs over), captionStyle, " +
      "embedCaptions (true/false: overlay captions in the 4:3 embed; null returns to the " +
      'default, which hides them when a synced voiceover is set), view ("tiktok", "screens" ' +
      'or "embed" — the player view the showcase opens in, for a showcase made for one ' +
      "destination; null returns to TikTok), cover, notes " +
      "(showcase-level authoring notes), soundtrack ({src, volume?, sync?}), tiktok ({fit?, " +
      "focus?, bands?, area?} — how every scene's picture goes into TikTok's 9:16 frame), or watermark " +
      "({asset?, text?, position?, inset?, shade?, opacity?, scale?}) — the brand mark drawn " +
      "in a corner of every slide, like a TV network's bug. position is one of the four " +
      "corners (top-left default); inset pushes the mark down from a top corner or up from " +
      'a bottom one to that height, in percent of the frame ("13%", 0–50%, clears ' +
      "TikTok's own interface); shade draws a dark panel behind the mark (true for a medium " +
      "shade, or an opacity 0–1); opacity defaults to 0.85. Use an identity mark (a logo, a " +
      "wordmark), not the App Store badge — that is a call to action and belongs in a " +
      "scene's cta.\n" +
      '- {field: "media.set", sceneId, media} — replace the scene\'s whole media mapping; ' +
      '{field: "media.asset", sceneId, value} just points it at another asset.\n' +
      '- {field: "publish.set", destination?, name, value} — the text the video is posted with ' +
      "(the top-level publish: block): name caption, hashtags (a list, no #) or title " +
      "(YouTube only). Leave destination out to set the default for every destination, " +
      'or name one — "tiktok", "instagram", "youtube" (the Short), "youtube43" (the regular ' +
      'YouTube video, from the 4:3 export) — to override it there. null or "" ' +
      "removes the field, so it inherits again. Check the result with share_status, which " +
      "reports each destination's final text and anything over a platform's limits.\n" +
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
    name: "create_showcase",
    description:
      "Make a new showcase folder in the library from a name — the same scaffold as the " +
      "studio's + card: <id>/showcase.yaml with a one-scene starter script and an empty " +
      "assets/ folder, the id made from the name (lower case, dashes). Returns {id, path}. " +
      "Then write the script with edit_showcase, and add the recording and pictures with " +
      "add_asset. Refused when a showcase of that id exists, or the studio is locked to one " +
      "showcase.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "The showcase's title" } },
      required: ["name"],
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
    name: "ffmpeg",
    description:
      "Run the bundled ffmpeg and put its output in a showcase's assets/ folder. Use it for " +
      "every clip, audio track or still that ffmpeg makes for a showcase — cutting a scene's " +
      "clip from the master recording, extracting or retiming audio, transcoding — instead " +
      "of running ffmpeg yourself with a path into assets/. `args` is ffmpeg's command line " +
      "without the output path, as a list of strings (no shell); the studio runs it from the " +
      "showcase folder, so inputs can be named as assets/master.mov. The studio writes the " +
      "output to a temporary file and renames it into assets/ as `output` only when ffmpeg " +
      "succeeds, so the player never sees a half-written file and re-cutting a clip that is " +
      "on screen works. An `output` name already in assets/ is replaced — that is what a " +
      "re-cut is. Returns the asset's key (the name without its extension), whether it " +
      "replaced a file, and the output's duration in ms. On failure, the error carries " +
      "ffmpeg's own message, and assets/ is left as it was. ffmpeg is still fine to run " +
      "yourself for reading — probing a duration, grabbing a frame into a temporary folder.",
    inputSchema: {
      type: "object",
      properties: {
        showcaseId: { type: "string", description: "The showcase's folder name" },
        output: {
          type: "string",
          description:
            "The file to make in assets/, e.g. clip-hook.mp4 — a name, no folder. Its " +
            "extension picks the container. Name it for what it shows: the key comes from it.",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description:
            'ffmpeg\'s arguments, in order, without the output path: e.g. ["-ss", "12.4", ' +
            '"-i", "assets/master.mov", "-t", "6", "-an", "-c:v", "libx264", "-pix_fmt", ' +
            '"yuv420p"]. -y and -nostdin are added for you.',
        },
      },
      required: ["showcaseId", "output", "args"],
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
      "showcases that loaded (id, title, slides, runtime, and the target runtime when " +
      "meta.targetMs sets one), the warnings (per scene: a field that isn't one or is in the " +
      "wrong place, against .studio/showcase.schema.json; a wrong value; themes and media; " +
      "length — a scene over its maxMs or meta.sceneMaxMs says how far over and why, a " +
      "showcase over meta.targetMs names its longest scenes), and, for any showcase that " +
      "failed, the error message; for a showcase whose media the studio builds, `media` " +
      "{kind, upToDate, stale, problem?}. Use it after YAML edits to confirm nothing broke, " +
      "read the length warnings before telling the user a showcase is done, and never leave " +
      "a warning unresolved.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_framing",
    description:
      "Find captions that sit over a face in the TikTok video of one showcase. For every " +
      "caption on a scene whose picture fills the frame (footage, feature screenshots, a " +
      "full-bleed statement), it renders the frame at the middle of that caption the way the " +
      "export renders it, finds the faces in it, and reports each caption whose chip covers " +
      "one: the scene, the time, where the face and the caption sit (percent of the frame, " +
      "from the top), and the fix — lift the picture with media.tiktok {fit: fill, focus: " +
      "bottom, bands: blur, area: {bottom: N%}}, or move the caption (position: top). Nothing " +
      "is written: apply the fix with edit_showcase, then look with screenshot_frame at the " +
      "time it names. Useful on a recorded pitch (a phone selfie puts the face right where " +
      "the bottom captions go) after a build or after changing a footage scene's media, " +
      "captions or TikTok fit. Takes a few seconds per showcase; a showcase unchanged since " +
      "its last check answers at once. The face finder is Apple's Vision framework, so on " +
      "Windows it answers {available: false, reason} — look at the frames yourself.",
    inputSchema: {
      type: "object",
      properties: {
        showcaseId: { type: "string", description: "The showcase's folder name" },
      },
      required: ["showcaseId"],
    },
  },
  {
    name: "transcribe",
    description:
      "Voice-to-text with timestamps: transcribe a recording (whisper.cpp, run locally). " +
      "Name it as {showcaseId, asset} — the asset key, the way add_asset and screenshot_frame " +
      "name files — or as {file}, a path. Returns sentence segments with per-word timestamps " +
      "in milliseconds — whole " +
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
        showcaseId: {
          type: "string",
          description: "The showcase's folder name (with asset)",
        },
        asset: {
          type: "string",
          description:
            "The recording in that showcase's assets/ folder, by key (take-8) or file name " +
            "(take-8.mp4)",
        },
        file: {
          type: "string",
          description:
            "Instead of showcaseId and asset: the recording as a path — absolute, or " +
            "relative to the showcases library root or to any showcase folder (e.g. " +
            "nova/assets/voiceover.mp3 or assets/voiceover.mp3)",
        },
        save: {
          type: "boolean",
          description:
            "Write the recording's editable transcript beside it, keeping the corrections an " +
            "existing one carries",
        },
      },
    },
  },
  {
    name: "build_media",
    description:
      "Build a recorded pitch's media from its cut list — the voiceover, one muted clip per " +
      "footage scene, the karaoke words file, and every scene's durationMs. The studio does " +
      "this on its own a few seconds after the cut list, the recording or the transcript " +
      "changes, and before any export or screenshot, so you rarely need to ask; call it to " +
      "force a rebuild, to build only some scenes, or to get a jobId to wait on with " +
      "build_status {waitMs} before you look at the result. Returns the running build of " +
      "the showcase when there is one, else starts one and returns its jobId.\n" +
      "The cut list lives in showcase.yaml: meta.source names the master recording " +
      "({video, speed}), and each scene's `take` names the span of it that scene owns " +
      "({from, to} in seconds; {silence: <seconds>} for a card with nothing spoken over it; a " +
      "list of spans to drop a pause; {audio: [...], video: [...]} when the picture " +
      "fast-forwards a pause the sound cuts out). Everything else is derived, so the picture " +
      "and the voice cannot drift apart — never pin durationMs by hand on a built showcase, " +
      "and never cut clips with your own ffmpeg calls or a script.\n" +
      "Builds are idempotent: only outputs whose inputs changed are rebuilt. `force` rebuilds " +
      "everything; `only` limits it to those scene ids. studio_info's `media` says whether " +
      "a showcase is up to date.",
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
    name: "build_voiceover",
    description:
      "Make a synthesized voiceover from a showcase's captions with AWS Polly, on the user's " +
      "own AWS account (through the aws command) — the track, the karaoke words file, and " +
      "every caption's durationMs. The studio does this on its own a few seconds after a " +
      "caption or the voice settings change, and before any export or screenshot; call it " +
      "to force a rebuild or to get a jobId to wait on with build_status {waitMs}. Returns " +
      "the running build of the showcase when there is one, else starts one.\n" +
      "The settings live in showcase.yaml's meta.voiceover: {voice (default Matthew), engine " +
      "(generative | neural | standard | long-form; default generative), profile and region " +
      "(optional: else the user's AWS defaults), track (the asset key, default voiceover)}. " +
      "Each caption gets one window: 250 ms lead + its spoken length + 450 ms tail, the last " +
      "one 1.5 s more for the end card (leadMs, tailMs, holdMs change those). The pins add up " +
      "to the track, so never pin durationMs by hand on a voiced showcase, and never make " +
      "the voice with your own Polly or ffmpeg calls.\n" +
      "Idempotent: clips are cached by voice, engine and text, so only changed captions call " +
      "Polly again. `force` makes every clip again. Needs the aws command signed in; without " +
      "whisper the words file falls back to estimated word times (the notes say so).",
    inputSchema: {
      type: "object",
      properties: {
        showcaseId: { type: "string", description: "The showcase's folder name" },
        force: {
          type: "boolean",
          description: "Call Polly again for every caption, even the unchanged ones",
        },
      },
      required: ["showcaseId"],
    },
  },
  {
    name: "build_status",
    description:
      "Check on a build_media or build_voiceover job: status (running | done | failed | canceled), what it is " +
      "doing now, and when it is done, what it built, what it left alone, the pins it wrote, " +
      "and any notes worth telling the user. Pass waitMs to wait for the build inside the call (up to 120000 ms).",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        waitMs: {
          type: "number",
          description: "How long to wait for the build before answering (0–120000 ms)",
        },
      },
      required: ["jobId"],
    },
  },
  {
    name: "build_cancel",
    description: "Cancel a running build_media or build_voiceover job.",
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
    name: "share_status",
    description:
      "Where a showcase stands for posting to TikTok, Instagram, YouTube Shorts and YouTube " +
      "(destinations tiktok, instagram, youtube, youtube43): for each destination, the text " +
      "it would post with (caption, hashtags, title — the showcase's publish: block with " +
      "that destination's overrides; `from` says where each came from), `paste` (the " +
      'caption box\'s text), `exportKind` (the video it takes: the 9:16 "video" for the ' +
      'first three, the 4:3 "video-43" for a regular YouTube upload), and `problems` (over ' +
      "a limit, too long a video, no title); the full-quality exports by kind and whether " +
      "each is `current` (it matches the showcase as it is now); and the hand-offs so far, " +
      "with their post links. `page` is the Share page's URL — open it for the user. Write " +
      "the text with edit_showcase (publish.set).",
    inputSchema: {
      type: "object",
      properties: {
        showcaseId: { type: "string", description: "The showcase's folder name" },
      },
      required: ["showcaseId"],
    },
  },
  {
    name: "share",
    description:
      "Hand a showcase's video off for posting to one destination, from this computer: " +
      "copies the destination's caption to the clipboard, opens its upload page in the " +
      "user's browser, and shows the video file in Finder or Explorer. The user then drags " +
      "the file onto the page, pastes, and posts — nothing is posted for them. Needs a " +
      'current export of the kind the destination takes: the full-quality video ("video" ' +
      'for tiktok, instagram and youtube; "video-43" for youtube43, the regular YouTube ' +
      'upload), or with quality: "draft" that kind\'s quick draft (half size, 12 fps) — good ' +
      "for trying the steps out, not for the real post. When there isn't one, nothing " +
      "happens and the result says so " +
      "(with about how long an export takes) — confirm with the user, run export, wait for " +
      "export_status to say done, then call share again. Ask the user which destination if " +
      "they didn't say. To AirDrop the video to a phone instead, send the user to the Share " +
      "page.",
    inputSchema: {
      type: "object",
      properties: {
        showcaseId: { type: "string", description: "The showcase's folder name" },
        destination: { type: "string", enum: DESTINATION_IDS },
        quality: {
          type: "string",
          enum: ["full", "draft"],
          description: "Which export to post (default full)",
        },
      },
      required: ["showcaseId", "destination"],
    },
  },
  {
    name: "share_record",
    description:
      "Keep a post's link once the user has posted: it is saved with the newest hand-off to " +
      "that destination that has no link yet (or a new record when there is none), and " +
      "shows in the Share page's history. The link must be on the destination's own site.",
    inputSchema: {
      type: "object",
      properties: {
        showcaseId: { type: "string", description: "The showcase's folder name" },
        destination: { type: "string", enum: DESTINATION_IDS },
        url: { type: "string", description: "The post's link" },
      },
      required: ["showcaseId", "destination", "url"],
    },
  },
  {
    name: "export",
    description:
      "Start an export of a showcase as a background job — returns a jobId immediately; poll " +
      "export_status (you can keep working meanwhile). A recorded or voiced showcase whose " +
      'media is out of date is built first, as part of the job. Kinds: "video-draft" renders a fast, ' +
      "small MP4 (12fps, half size) — use it freely to check your work while iterating; " +
      '"video" is the full-quality 1080×1920 (9:16) TikTok render and takes minutes — confirm with the user ' +
      'before starting one; "video-43" / "video-43-draft" render the 4:3 embed canvas ' +
      "(1440×1080, for YouTube and desktop embeds — feature and footage scenes show text " +
      'beside the media); "screens" captures the App Store screenshot set; "script" ' +
      "writes the narration as <id>_script.txt (instant). Output lands in " +
      "~/Downloads/showcase-exports/<id>, named <id>[_43][_draft].mp4 (screenshots in " +
      "screens/); older exports move to history/ in that folder, numbered " +
      "(history/<id>_draft.1.mp4, history/screens.1/). One " +
      "export runs at a time, shared with the studio's Export button. Full-quality videos " +
      '("video", "video-43") need a subscription after the computer\'s 2 free ones — ' +
      "studio_info's license says how many are left; when none are, the job fails with a " +
      "message to pass on: the user subscribes from the studio's Trial button. Drafts, " +
      "screens and script are always free.",
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
      "progress label, and the output path once done. Pass waitMs to wait for the job " +
      "inside the call (up to 120000 ms) and get its status when it finishes or the wait " +
      "runs out — one call instead of polling; a full-quality video takes minutes, so " +
      "wait in a few calls and tell the user between them.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        waitMs: {
          type: "number",
          description: "How long to wait for the job before answering (0–120000 ms)",
        },
      },
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

/* What a recording's asset key can be the key of: the sound and video
 * files whisper can read. A transcript or words file beside the
 * recording shares its key and is never the recording. */
const RECORDING_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".m4a",
  ".mp3",
  ".wav",
  ".aac",
  ".ogg",
  ".flac",
]);

/** The recording a transcribe call names: {showcaseId, asset} — the
 *  asset key or file name in that showcase's assets/ folder, the way
 *  the other tools name files — or {file}, a path. Throws when it names
 *  nothing, saying what was looked for and where. */
export function resolveRecording(args, showcasesDir) {
  const showcaseId = String(args.showcaseId ?? "");
  const asset = String(args.asset ?? "");
  const file = String(args.file ?? "");
  if (asset || (showcaseId && !file)) {
    if (!showcaseId || !asset) {
      throw new Error(
        "Name the recording as {showcaseId, asset} — the showcase's folder name and the " +
          "recording's asset key (take-8) or file name (take-8.mp4) — or as {file}, a path.",
      );
    }
    const assetsDir = path.join(showcasesDir, showcaseId, "assets");
    if (!existsSync(assetsDir)) {
      throw new Error(
        `No showcase named "${showcaseId}" in the library (no ${showcaseId}/assets).`,
      );
    }
    const names = readdirSync(assetsDir);
    const found =
      names.find((n) => n === asset && RECORDING_EXTENSIONS.has(path.extname(n).toLowerCase())) ??
      names.find(
        (n) =>
          path.basename(n, path.extname(n)) === asset &&
          RECORDING_EXTENSIONS.has(path.extname(n).toLowerCase()),
      );
    if (!found) {
      throw new Error(
        `No recording named "${asset}" in ${showcaseId}/assets (looked for a sound or video ` +
          `file by that key or file name).`,
      );
    }
    return path.join(assetsDir, found);
  }
  const audioPath = file && resolveAudio(file, showcasesDir);
  if (!audioPath) {
    throw new Error(
      `No file named "${file}" found (looked in the library root and each showcase folder; ` +
        `absolute paths work too). Or name it as {showcaseId, asset}.`,
    );
  }
  return audioPath;
}

/* Transcription outlives the page-tool cap: a cold call downloads the
 * model and a long recording takes real time. */
const TRANSCRIBE_TIMEOUT_MS = 300_000;

const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

/** Builds a showcase's media first when it is out of date, so a
 *  screenshot or a check never shows stale clips (server/auto-build.mjs). */
async function builtFirst(context, showcaseId, tool) {
  const id = String(showcaseId ?? "");
  if (!id || !context.autoBuild) return;
  await context.autoBuild.ensureBuilt(id, {
    by: "claude",
    why: `${id}'s media was out of date before ${tool}`,
  });
}

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

/** The line under a frame: when it is, what the page showed there, and
 *  how it was rendered — "Frame at 24500 ms (0:24.5) — scene
 *  \"grand-finale\" (3 of 5, 1200 ms in), caption 1 of 1 (\"to a grand
 *  finale…\"); TikTok view, 540×960 (half size), animations finished,
 *  safe area shaded." */
export function frameLine(frame, { view, width, height, size, animations, safeArea }) {
  const parts = [`Frame at ${frame.atMs} ms (${formatClock(frame.atMs)})`];
  const shows = [];
  if (frame.scene) {
    shows.push(
      `scene "${frame.scene.id}" (${frame.scene.index + 1} of ${frame.scene.count}, ` +
        `${frame.scene.elapsedMs} ms in)`,
    );
    const caption = frame.caption;
    if (caption) {
      const text = caption.text.length > 60 ? `${caption.text.slice(0, 59)}…` : caption.text;
      shows.push(`caption ${caption.index + 1} of ${caption.count} ("${text}")`);
    } else {
      shows.push("no caption");
    }
  }
  const how = [
    view === "43" ? "4:3 view" : "TikTok view",
    `${width}×${height}${size === "half" ? " (half size)" : ""}`,
    animations === "live" ? "animations live" : "animations finished",
    ...(safeArea ? ["safe area shaded"] : []),
  ];
  return `${parts.join("")}${shows.length ? ` — ${shows.join(", ")}` : ""}; ${how.join(", ")}.`;
}

/** The most a status call waits for a job, and how often it looks. */
export const MAX_WAIT_MS = 120_000;
const WAIT_POLL_MS = 500;

/** A job's status now — or, with `waitMs`, once it is no longer running
 *  or that long has passed, whichever comes first. Null for no such job. */
export async function jobStatus(jobs, jobId, waitMs, { sleep = delay, now = Date.now } = {}) {
  const wait = Math.min(Math.max(Number(waitMs) || 0, 0), MAX_WAIT_MS);
  const deadline = now() + wait;
  let status = jobs.status(jobId);
  while (status?.status === "running" && now() < deadline) {
    await sleep(Math.min(WAIT_POLL_MS, Math.max(0, deadline - now())));
    status = jobs.status(jobId);
  }
  return status;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs one tool against a studio. `context` is
 *  { info(), getUrl(), getShowcasesDir(), renderer, exportJobs, buildJobs,
 *  changeLog, history, share, openUrl, copyText, reveal }. */
export async function callTool(context, { name, arguments: args = {} } = {}) {
  const showcasesDir = context.getShowcasesDir();
  const sharePage = (showcaseId) =>
    context.getUrl()
      ? `${context.getUrl()}/showcase/${encodeURIComponent(showcaseId)}/share`
      : null;
  if (name === "share_status") {
    const showcaseId = String(args.showcaseId ?? "");
    return json({ ...context.share.status(showcaseId), page: sharePage(showcaseId) });
  }
  if (name === "share") {
    const showcaseId = String(args.showcaseId ?? "");
    const destination = String(args.destination ?? "");
    const quality = args.quality === "draft" ? "draft" : "full";
    let handoff;
    try {
      handoff = context.share.handOff({ showcaseId, destination, method: "computer", quality });
    } catch (error) {
      if (!/no current (draft|full-quality) (4:3 )?video/.test(error.message)) throw error;
      const { exports } = context.share.status(showcaseId);
      /* The kind this destination takes: 9:16, or 4:3 for a regular
       * YouTube upload. */
      const base = DESTINATIONS[destination].exportKind;
      const kind = quality === "draft" ? `${base}-draft` : base;
      const minutes = Math.max(1, Math.round(exports[kind].estimateMs / 60_000));
      const draftReady = quality === "full" && exports[`${base}-draft`].current;
      return json({
        handedOff: false,
        reason: error.message,
        latestExport: exports[kind].latest,
        estimateMs: exports[kind].estimateMs,
        next:
          `Tell the user the video needs a fresh ${quality === "draft" ? "draft" : "full-quality"} ` +
          `export — about ${minutes} minute${minutes > 1 ? "s" : ""} — and with their go-ahead ` +
          `run export {kind: "${kind}"}; when export_status says done, call share again.` +
          (draftReady
            ? ' A current draft exists: share with quality: "draft" tries the steps with it now.'
            : ""),
        page: sharePage(showcaseId),
      });
    }
    const { problems } = context.share
      .status(showcaseId)
      .destinations.find((d) => d.id === destination);
    const copied = handoff.paste ? await context.copyText(handoff.paste) : false;
    context.openUrl(handoff.uploadUrl);
    context.reveal(handoff.video.file);
    return json({
      handedOff: true,
      handoff: handoff.record,
      video: handoff.video.file,
      quality,
      uploadUrl: handoff.uploadUrl,
      copied,
      ...(copied ? {} : { paste: handoff.paste }),
      /* Over a limit, no title: worth telling the user before they post. */
      problems,
      next:
        `Tell the user: the upload page is open in their browser and the video is selected in ` +
        `their file manager — drag it onto the page, ` +
        (copied ? "paste the caption (it's on the clipboard)" : "paste the caption below") +
        (handoff.record.text.title ? `, give it the title "${handoff.record.text.title}"` : "") +
        ", and post. Ask for the post's link afterwards and keep it with share_record.",
      page: sharePage(showcaseId),
    });
  }
  if (name === "share_record") {
    return json(
      context.share.recordPostUrl({
        showcaseId: String(args.showcaseId ?? ""),
        destination: String(args.destination ?? ""),
        url: args.url,
      }),
    );
  }
  if (name === "studio_info") {
    return json({
      ...context.info(),
      showcases: showcaseIndex(showcasesDir).showcases.map((s) => s.id),
      /* What a session reads before it writes: the guide, and the
       * schema (the fields of showcase.yaml, their types, where each
       * goes), both written into the library at every start. */
      guide: path.join(showcasesDir, ".studio", "GUIDE.md"),
      schema: path.join(showcasesDir, ".studio", "showcase.schema.json"),
      /* Every showcase whose media the studio builds, and whether it is
       * up to date (server/media-status.mjs). */
      media: context.mediaSummary?.() ?? [],
      changes: context.changeLog?.path(),
      ...(context.history ? { history: await context.history.status() } : {}),
      ...(context.actions ? { actions: context.actions.summary() } : {}),
      ...(context.license ? { license: context.license.status() } : {}),
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
  if (name === "ffmpeg") {
    const showcaseId = String(args.showcaseId ?? "");
    const result = await encodeAsset(showcasesDir, {
      showcaseId,
      output: args.output,
      args: args.args,
    });
    if (!result.ok) throw new Error(result.error);
    context.changeLog?.append({
      source: "mcp",
      showcaseId,
      kind: "asset.encode",
      name: result.asset.name,
      replaced: result.replaced,
      args: args.args,
    });
    const { ok: _ok, ...rest } = result;
    return json({ showcaseId, ...rest });
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
  if (name === "build_media" || name === "build_voiceover") {
    const showcaseId = String(args.showcaseId ?? "");
    /* The studio may already be building this showcase on its own: that
     * build is the one to wait on, unless a rebuild was asked for. */
    const running = context.buildJobs.current();
    if (running?.status === "running" && running.showcaseId === showcaseId && !args.force) {
      return json(running);
    }
    /* A build that can't start — the cut list doesn't read, or no AWS
     * profile is set up for the voice — is answered here, as the problem,
     * rather than run to fail: the Actions list already says so once,
     * from the automatic build, and a second failed record would only
     * repeat it. */
    const status = context.mediaStatus?.(showcaseId);
    if (status?.built && status.ok === false) throw new Error(status.problem);
    return json(
      context.buildJobs.start(name === "build_media" ? "build" : "voiceover", showcaseId, {
        force: args.force === true,
        only:
          name === "build_media" && Array.isArray(args.only) ? args.only.map(String) : undefined,
        by: "claude",
      }),
    );
  }
  if (name === "build_status" || name === "build_cancel") {
    const jobId = String(args.jobId ?? "");
    const result =
      name === "build_cancel"
        ? context.buildJobs.cancel(jobId)
        : await jobStatus(context.buildJobs, jobId, args.waitMs);
    if (!result) throw new Error(`No build job named "${jobId}"`);
    return json(result);
  }
  if (name === "export") {
    const kind = String(args.kind ?? "");
    if (!EXPORT_KINDS.includes(kind)) {
      throw new Error(`Unknown export kind "${kind}" — use one of: ${EXPORT_KINDS.join(", ")}`);
    }
    return json(context.exportJobs.start(kind, String(args.showcaseId ?? ""), { by: "claude" }));
  }
  if (name === "export_status" || name === "export_cancel") {
    const jobId = String(args.jobId ?? "");
    const result =
      name === "export_cancel"
        ? context.exportJobs.cancel(jobId)
        : await jobStatus(context.exportJobs, jobId, args.waitMs);
    if (!result) throw new Error(`No export job named "${jobId}"`);
    return json(result);
  }
  if (name === "transcribe") {
    const audioPath = resolveRecording(args, showcasesDir);
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
    await builtFirst(context, args.showcaseId, name);
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
  if (name === "screenshot_frame") {
    await builtFirst(context, args.showcaseId, name);
    const result = await screenshotFrame(context.renderer, context.getUrl(), showcasesDir, args);
    const content = [];
    for (const frame of result.frames) {
      content.push({ type: "image", data: frame.png, mimeType: "image/png" });
      content.push({ type: "text", text: frameLine(frame, result) });
    }
    return { content };
  }
  if (name === "create_showcase") {
    if (!context.createShowcase) throw new Error("This studio can't create showcases");
    const title = String(args.name ?? "").trim();
    const result = context.createShowcase(title);
    if (!result.ok) throw new Error(result.error);
    context.changeLog?.append({
      source: "mcp",
      tool: "create_showcase",
      showcaseId: result.id,
      kind: "showcase.create",
      title,
    });
    return json({ id: result.id, path: path.join(showcasesDir, result.id) });
  }
  if (name === "check_framing") {
    const showcaseId = String(args.showcaseId ?? "");
    if (!showcaseId) throw new Error("showcaseId is required");
    const finder = context.faceFinder ?? createFaceFinder();
    if (!finder.available) return json({ available: false, showcaseId, reason: finder.reason });
    await builtFirst(context, showcaseId, name);
    const result = await checkCaptionsOverFaces({
      renderer: context.renderer,
      appUrl: context.getUrl(),
      showcasesDir,
      showcaseId,
      finder,
      cacheFile: path.join(showcasesDir, ".studio", "build", `${showcaseId}.faces.json`),
      appVersion: context.info?.()?.version ?? null,
    });
    return json({
      available: true,
      showcaseId,
      summary: facesSummary(showcaseId, result),
      checked: result.checked,
      overlaps: result.overlaps,
      fromCache: result.fromCache,
    });
  }
  if (name === "validate") {
    const report = await validateShowcases(context.renderer, context.getUrl());
    /* Whether each built showcase's media is up to date (media-status.mjs). */
    for (const loaded of report.loaded ?? []) {
      const media = context.mediaStatus?.(loaded.id);
      if (!media?.built) continue;
      const { kind, ok, stale, upToDate, problem } = media;
      loaded.media = { kind, ...(ok ? { upToDate, stale } : { upToDate: false, problem }) };
    }
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
