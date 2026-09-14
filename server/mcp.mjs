/* The studio's MCP tools — how Claude drives the studio. Served as
 * streamable HTTP at /mcp by the studio server (a plain JSON-RPC handler,
 * no SDK), and reachable with no port to configure through the stdio
 * bridge (server/mcp-stdio.mjs), which answers the handshake with the
 * same code and forwards tool calls here.
 *
 * Page tools (screenshot_slide, validate, export) render through the
 * studio's page renderer, so they see the current files on disk — the
 * same files Claude just edited. */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { EXPORT_KINDS } from "./launch-options.mjs";
import { applySceneEditsToFolder } from "./scene-edit.mjs";
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
      "showcase the studio is locked to, if any). Call it first to find the studio.",
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
      "authoring note — keep working context here, not in YAML comments), or cta " +
      "({label, url, kind?}). null removes an optional field.\n" +
      '- {field: "caption.set", sceneId, captionIndex, name, value} — a caption\'s text, ' +
      "durationMs, or position (top|center|lower|bottom).\n" +
      '- {field: "caption.insert", sceneId, captionIndex, caption: {text, ...}} and ' +
      '{field: "caption.delete", sceneId, captionIndex}\n' +
      '- {field: "scene.insert", index, scene: {id, theme, captions, media, ...}}, ' +
      '{field: "scene.delete", sceneId}, and {field: "scene.move", sceneId, index}\n' +
      '- {field: "meta.set", name, value} — meta title, description, loop, pace, captionStyle, ' +
      "cover, notes (showcase-level authoring notes), or soundtrack ({src, volume?, sync?}).\n" +
      '- {field: "media.set", sceneId, media} — replace the scene\'s whole media mapping; ' +
      '{field: "media.asset", sceneId, value} just points it at another asset.\n' +
      "The studio's pages reload on the write; run validate or screenshot_slide to check the " +
      "result. theme.yaml and comments are not covered — edit those directly.",
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
      },
      required: ["showcaseId", "edits"],
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
      "locally). Returns sentence segments with per-word timestamps in milliseconds. Use it to " +
      "align narration to scenes, split a voiceover into scene-scoped clips (cut with ffmpeg at " +
      "the returned boundaries), or check what a recording actually says — silencedetect only " +
      "finds pauses, this finds the words. First use downloads the speech model (~142MB), so " +
      "the first call can take a minute.",
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
      },
      required: ["file"],
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
      '"video" is the full-quality 1320×2868 render and takes minutes — confirm with the user ' +
      'before starting one; "video-43" / "video-43-draft" render the 4:3 embed canvas ' +
      "(1440×1080, for YouTube and desktop embeds — feature and footage scenes show text " +
      'beside the media); "screens" captures the App Store screenshot set; "script" ' +
      "writes the narration as <id>_script.txt (instant). Output lands in " +
      "~/Downloads/showcase-exports/<id>, named <id>[_43][_draft].mp4. One export runs at a time.",
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

/** Runs one tool against a studio. `context` is
 *  { info(), getUrl(), getShowcasesDir(), renderer, exportJobs }. */
async function callTool(context, { name, arguments: args = {} } = {}) {
  const showcasesDir = context.getShowcasesDir();
  if (name === "studio_info") {
    return json({
      ...context.info(),
      showcases: showcaseIndex(showcasesDir).showcases.map((s) => s.id),
    });
  }
  if (name === "edit_showcase") {
    const result = applySceneEditsToFolder(showcasesDir, {
      showcaseId: args.showcaseId,
      edits: args.edits,
    });
    if (!result.ok) throw new Error(result.error);
    return json({ applied: result.applied });
  }
  if (name === "script") {
    return {
      content: [{ type: "text", text: scriptText(showcasesDir, String(args.showcaseId ?? "")) }],
    };
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
      transcribe(audioPath, { progress: (label) => console.log(`transcribe: ${label}`) }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Transcription timed out after 5 minutes")),
          TRANSCRIBE_TIMEOUT_MS,
        );
      }),
    ]).finally(() => clearTimeout(timer));
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
 *  result; a thrown error becomes a tool error Claude can read. */
export function createMcpRpc({ version, callTool: runTool }) {
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
        return respond({ tools: TOOLS });
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
