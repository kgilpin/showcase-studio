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
import { SHOWCASE_GUIDE } from "./showcase-guide.mjs";

const MODEL = "claude-opus-5";

const SYSTEM_PROMPT = `You are the Showcase Studio agent. You help the user author app showcases — auto-playing, video-style product tours — by editing the data files in their showcases folder. The app live-reloads whenever you write a file, so the user sees changes immediately.

${SHOWCASE_GUIDE}

## Studio-specific rules
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
