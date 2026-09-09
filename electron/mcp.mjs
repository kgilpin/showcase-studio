/* The studio's MCP server: structured tools for the Claude Code sessions
 * the studio opens (and any the user points at .studio/mcp.json). Served
 * as streamable HTTP on the data server's port at /mcp — a plain JSON-RPC
 * handler, no SDK.
 *
 *   screenshot_slide  renders one slide's export page in an offscreen
 *                     window (the exporter's technique, half size) and
 *                     returns the PNG — Claude can see its work instead
 *                     of editing YAML and TSX diagrams blind.
 *   validate          loads the library in a fresh offscreen page exactly
 *                     as the app does and reports what loaded and what
 *                     failed, with the errors.
 *
 * Both tools read through the running dev server, so they see the current
 * on-disk state (the same files Claude just edited). */
import { BrowserWindow, screen } from "electron";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { applySceneEditsToFolder } from "../server/scene-edit.mjs";
import { scriptText } from "./exporter.mjs";
import { transcribe, whisperPath } from "./transcribe.mjs";

const PROTOCOL_VERSIONS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);

const TOOLS = [
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
      "support, ctaNote, captionStyle, transition, durationMs, export, id, or cta " +
      "({label, url, kind?}). null removes an optional field.\n" +
      '- {field: "caption.set", sceneId, captionIndex, name, value} — a caption\'s text, ' +
      "durationMs, or position (top|center|lower|bottom).\n" +
      '- {field: "caption.insert", sceneId, captionIndex, caption: {text, ...}} and ' +
      '{field: "caption.delete", sceneId, captionIndex}\n' +
      '- {field: "scene.insert", index, scene: {id, theme, captions, media, ...}}, ' +
      '{field: "scene.delete", sceneId}, and {field: "scene.move", sceneId, index}\n' +
      '- {field: "meta.set", name, value} — meta title, description, loop, pace, captionStyle, ' +
      "cover, or soundtrack ({src, volume?, sync?}).\n" +
      '- {field: "media.set", sceneId, media} — replace the scene\'s whole media mapping; ' +
      '{field: "media.asset", sceneId, value} just points it at another asset.\n' +
      "The app live-reloads on the write; run validate or screenshot_slide to check the " +
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
        kind: {
          type: "string",
          enum: ["screens", "video", "video-draft", "video-43", "video-43-draft", "script"],
        },
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

/* Half App Store size — text is readable, payloads stay small. Offscreen
 * windows render at the display's scale factor, so size the window down
 * to land the capture at the target (same trick as exporter.mjs). */
const SHOT_WIDTH = 660;
const SHOT_HEIGHT = 1434;

/* A page that navigates or crashes strands in-flight executeJavaScript
 * promises (they never settle), which would leave the tool call — and
 * Claude — hanging forever. Every page interaction races this cap. */
const PAGE_TIMEOUT_MS = 20_000;
function withTimeout(promise, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), PAGE_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

function offscreenWindow(width, height) {
  const scale = screen.getPrimaryDisplay().scaleFactor || 1;
  return new BrowserWindow({
    show: false,
    width: Math.round(width / scale),
    height: Math.round(height / scale),
    frame: false,
    enableLargerThanScreen: true,
    webPreferences: { offscreen: true },
  });
}

async function screenshotSlide(appUrl, { showcaseId, sceneId } = {}) {
  if (!showcaseId || !sceneId) throw new Error("showcaseId and sceneId are both required");
  const win = offscreenWindow(SHOT_WIDTH, SHOT_HEIGHT);
  try {
    return await withTimeout(
      (async () => {
        await win.loadURL(`${appUrl}/showcase/${showcaseId}/export/${sceneId}`);
        await win.webContents.executeJavaScript(`(async () => {
          while (!document.querySelector(".export-static")) {
            await new Promise((r) => setTimeout(r, 50));
          }
          await document.fonts.ready;
          await Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => {})));
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        })()`);
        const image = await win.webContents.capturePage();
        return image.toPNG().toString("base64");
      })(),
      `The slide did not render — check the showcase id ("${showcaseId}") and scene id ` +
        `("${sceneId}"), and whether the showcase loads at all (run validate).`,
    );
  } finally {
    win.destroy();
  }
}

async function validateShowcases(appUrl) {
  const win = offscreenWindow(SHOT_WIDTH, SHOT_HEIGHT);
  try {
    /* A fresh page load re-fetches the library from disk; the app's own
     * loader module reports what built and what didn't. (Dev-server
     * module path — revisit when the shell loads a built SPA.) */
    return await withTimeout(
      (async () => {
        await win.loadURL(`${appUrl}/`);
        return await win.webContents.executeJavaScript(`(async () => {
          for (;;) {
            try {
              const m = await import("/src/content/showcases.ts");
              await m.showcasesReady;
              return {
                loaded: m.showcases.map((s) => ({
                  id: s.id,
                  title: s.title,
                  slides: s.scenes.length,
                  runtimeSeconds: Math.round(
                    s.scenes.reduce((sum, x) => sum + x.durationMs, 0) / 1000,
                  ),
                })),
                errors: m.showcaseErrors,
                warnings: m.showcaseWarnings,
              };
            } catch {
              await new Promise((r) => setTimeout(r, 200));
            }
          }
        })()`);
      })(),
      "The library did not finish loading — is the studio's app page reachable?",
    );
  } finally {
    win.destroy();
  }
}

/* Transcription outlives the page-tool cap: a cold call downloads the
 * model and a long recording takes real time. */
const TRANSCRIBE_TIMEOUT_MS = 300_000;

const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

async function callTool(appUrl, getShowcasesDir, exportJobs, { name, arguments: args = {} } = {}) {
  if (name === "edit_showcase") {
    const result = applySceneEditsToFolder(getShowcasesDir(), {
      showcaseId: args.showcaseId,
      edits: args.edits,
    });
    if (!result.ok) throw new Error(result.error);
    return json({ applied: result.applied });
  }
  if (name === "script") {
    return {
      content: [
        { type: "text", text: scriptText(getShowcasesDir(), String(args.showcaseId ?? "")) },
      ],
    };
  }
  if (name === "export") {
    const kind = String(args.kind ?? "");
    if (
      !["screens", "video", "video-draft", "video-43", "video-43-draft", "script"].includes(kind)
    ) {
      throw new Error(
        `Unknown export kind "${kind}" — use screens, video, video-draft, video-43, ` +
          `video-43-draft, or script`,
      );
    }
    return json(exportJobs.start(kind, String(args.showcaseId ?? "")));
  }
  if (name === "export_status" || name === "export_cancel") {
    const jobId = String(args.jobId ?? "");
    const result = name === "export_cancel" ? exportJobs.cancel(jobId) : exportJobs.status(jobId);
    if (!result) throw new Error(`No export job named "${jobId}"`);
    return json(result);
  }
  if (name === "transcribe") {
    const file = String(args.file ?? "");
    const audioPath = file && resolveAudio(file, getShowcasesDir());
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
    const data = await screenshotSlide(appUrl, args);
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
    const report = await validateShowcases(appUrl);
    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}

/** The /mcp request handler for the data server. */
export function createMcpHandler({ appUrl, version, getShowcasesDir, exportJobs }) {
  const rpc = async ({ id, method, params }) => {
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
          return respond(await callTool(appUrl, getShowcasesDir, exportJobs, params));
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
    if (message?.id === undefined) {
      // A notification (e.g. notifications/initialized) — no reply body.
      res.statusCode = 202;
      res.end();
      return;
    }
    const reply = await rpc(message);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(reply));
  };
}
