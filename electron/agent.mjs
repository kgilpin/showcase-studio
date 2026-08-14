/* The studio's BYOK agent: a Claude-powered assistant that authors
 * showcases by editing the user's showcases folder through a small tool
 * set (electron/agent-tools.mjs). Runs in the Electron main process; the
 * renderer talks to it over the preload bridge (window.showcaseStudio.agent).
 *
 * The user's Anthropic API key is stored encrypted with Electron's
 * safeStorage under the app's userData directory and never leaves the
 * main process.
 */
import Anthropic from "@anthropic-ai/sdk";
import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AGENT_TOOLS, makeToolExecutor } from "./agent-tools.mjs";

const MODEL = "claude-opus-5";

const SYSTEM_PROMPT = `You are the Showcase Studio agent. You help the user author app showcases — auto-playing, video-style product tours — by editing the data files in their showcases folder. The app live-reloads whenever you write a file, so the user sees changes immediately.

## The data model
Each showcase is a folder: <id>/showcase.yaml (the script), optional theme.yaml (styling), and assets/ (screenshots; asset keys are file names without extension).

showcase.yaml:
- meta: title, description, loop, soundtrack {src, volume}, optional pace (narration reading speed in words/second, default 2.5).
- scenes: a list of slides with fields: id; theme; title; optional eyebrow (a label shown only on the teleprompter and script pages — never on slides); captions (list of {text, durationMs?, position? top|center|lower|bottom}); media; optional support (small supporting line, statement slides); optional cta {label, url}; export: false leaves the scene out of the App Store screenshot set (the video always includes every scene); durationMs / titleDurationMs pin timing explicitly.
- Themes: "title" — a full-screen text slide whose title IS spoken narration (on-camera beats, intros, outros); "feature" — title over a phone screenshot, the title is on-screen text only; "statement" — centered text slide; "console" — wide landscape media panel.
- media: {kind: none} or {kind: image|video, asset: <key>, alt, motion? zoom-in|zoom-out|pan-up|pan-left|still, frame? phone|full|mark, fit? cover|contain, align? top|center|bottom, fadeTo? {asset, alt, align?}}.
- Captions are the narration, read verbatim in order — one continuous voiceover across the whole showcase. There are two presentations: App Screens (slide titles shown, captions off the media) and video (captions overlaid, feature titles hidden).
- Timing derives from the copy by default: each caption prices out at its reading time (words at meta.pace plus settle and punctuation beats), spoken titles own the start of title slides, and a slide is exactly long enough to speak its lines. Only pin durationMs when there is a concrete reason (e.g. syncing to music).

theme.yaml (optional): whitelisted styling — colors, fonts {display, body, load: [stylesheet urls]}, shape {radius}, atmosphere {gradient-stage, gradient-accent, shadow-device}; extends: <other-showcase-id> inherits another showcase's theme.

## Working rules
- Read a file before rewriting it, and keep YAML valid — a parse error breaks the app until fixed.
- Screenshots are binary; you cannot create them. Ask the user to drop images into the showcase's assets/ folder, then reference them by key.
- Keep narration natural to read aloud, and slides focused — one idea per slide.
- Use export_showcase for deliverables when the user asks (video renders take several minutes).
- Keep responses focused, brief, and concise. When you edit files, say what changed and why in a sentence or two — the user sees the result live in the app.`;

function keyPath() {
  return path.join(app.getPath("userData"), "anthropic-key.enc");
}

function loadKey() {
  try {
    if (!existsSync(keyPath())) return undefined;
    return safeStorage.decryptString(readFileSync(keyPath()));
  } catch {
    return undefined;
  }
}

function saveKey(key) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("This system cannot store the key securely (safeStorage unavailable)");
  }
  mkdirSync(path.dirname(keyPath()), { recursive: true });
  writeFileSync(keyPath(), safeStorage.encryptString(key));
}

/** One agent conversation per studio window; reset starts fresh. */
export function registerAgent(ipcMain, win, { showcasesDir, runExport }) {
  const runTool = makeToolExecutor({ showcasesDir, runExport });
  let history = [];
  let busy = false;

  const emit = (event) => win.webContents.send("agent-event", event);

  ipcMain.handle("agent-status", () => ({ hasKey: Boolean(loadKey()), model: MODEL }));

  ipcMain.handle("agent-set-key", async (_event, key) => {
    // Validate before storing so a typo surfaces immediately.
    const client = new Anthropic({ apiKey: key });
    try {
      await client.models.retrieve(MODEL);
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        return { ok: false, error: "That API key was rejected — check it and try again." };
      }
      return { ok: false, error: `Could not verify the key: ${error.message ?? error}` };
    }
    saveKey(key);
    return { ok: true };
  });

  ipcMain.handle("agent-clear-key", () => {
    rmSync(keyPath(), { force: true });
    history = [];
    return { ok: true };
  });

  ipcMain.handle("agent-reset", () => {
    history = [];
    return { ok: true };
  });

  ipcMain.handle("agent-send", async (_event, text) => {
    const key = loadKey();
    if (!key) return { ok: false, error: "No API key configured" };
    if (busy) return { ok: false, error: "The agent is already working" };
    busy = true;
    const client = new Anthropic({ apiKey: key });
    history.push({ role: "user", content: text });
    try {
      await runTurn(client, history, runTool, emit);
      emit({ type: "done" });
      return { ok: true };
    } catch (error) {
      // Drop the failed turn so the conversation can continue cleanly.
      while (history.length > 0 && history.at(-1).role !== "assistant") history.pop();
      const message = error?.message ?? String(error);
      emit({ type: "error", message });
      return { ok: false, error: message };
    } finally {
      busy = false;
    }
  });
}

/* The documented streaming manual loop: stream a response, run any tool
 * calls, append results, repeat until the model ends its turn. Server-side
 * refusal fallbacks are enabled so a safety-classifier decline re-runs on
 * Anthropic's recommended fallback model instead of dead-ending. */
async function runTurn(client, history, runTool, emit) {
  for (;;) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: AGENT_TOOLS,
      messages: history,
    });
    stream.on("text", (delta) => emit({ type: "text", text: delta }));
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      emit({ type: "error", message: "The model declined this request." });
      return;
    }

    history.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "pause_turn") continue;

    const toolUses = message.content.filter((block) => block.type === "tool_use");
    if (toolUses.length === 0) return;

    const results = [];
    for (const use of toolUses) {
      emit({ type: "tool", name: use.name, input: use.input });
      try {
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: await runTool(use.name, use.input),
        });
      } catch (error) {
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: error?.message ?? String(error),
          is_error: true,
        });
      }
    }
    history.push({ role: "user", content: results });
  }
}
