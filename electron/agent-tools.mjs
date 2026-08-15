/* The studio agent's tool surface: read and write files inside the user's
 * showcases folder, list what's there, and run exports. Pure module (no
 * Electron imports) so it can be tested headlessly with node.
 *
 * Every path is confined to the showcases folder; writes are limited to
 * text files (the agent authors YAML and notes — screenshots are dropped
 * in by the user).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { showcaseIndex } from "../scripts/showcase-data.mjs";

const READ_LIMIT_BYTES = 200_000;
const WRITABLE_EXTENSIONS = new Set([".yaml", ".yml", ".md", ".txt", ".tsx", ".jsx", ".svg"]);

export const AGENT_TOOLS = [
  {
    name: "list_showcases",
    description:
      "List every showcase in the folder: its id, whether it has a theme.yaml, and its asset file names (asset keys are these names without extension).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_file",
    description:
      "Read a text file from the showcases folder. Always read a file before rewriting it.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            'Path relative to the showcases folder, e.g. "nova/showcase.yaml"',
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description:
      "Write a text file (yaml, md, txt) inside the showcases folder, creating parent folders as needed. The app live-reloads on every write, so the user sees the change immediately. Keep YAML valid — a parse error breaks the app until fixed.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            'Path relative to the showcases folder, e.g. "nova/showcase.yaml"',
        },
        content: { type: "string", description: "The complete new file content." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "export_showcase",
    description:
      "Render a showcase to deliverables in the user's Downloads folder: 'screens' captures App Store screenshots (1320×2868), 'video' renders the full MP4 frame-by-frame (takes several minutes). Call this when the user asks for exports, after content changes are settled.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["screens", "video"] },
        showcaseId: { type: "string", description: "The showcase folder name." },
      },
      required: ["kind", "showcaseId"],
      additionalProperties: false,
    },
  },
];

/** Resolves `rel` inside `dir`, rejecting anything that escapes it. */
function resolveInside(dir, rel) {
  const full = path.resolve(dir, rel);
  if (full !== dir && !full.startsWith(dir + path.sep)) {
    throw new Error(`Path "${rel}" escapes the showcases folder`);
  }
  return full;
}

/** Returns an async executor for AGENT_TOOLS over `showcasesDir` (a path,
 *  or a function returning the current path so the folder can be switched
 *  at runtime). `runExport(kind, showcaseId)` is injected by the shell. */
export function makeToolExecutor({ showcasesDir, runExport }) {
  const dirOf = () => (typeof showcasesDir === "function" ? showcasesDir() : showcasesDir);
  return async function runTool(name, input) {
    switch (name) {
      case "list_showcases":
        return JSON.stringify(showcaseIndex(dirOf()), null, 2);
      case "read_file": {
        const file = resolveInside(dirOf(), input.path);
        if (!existsSync(file)) throw new Error(`No such file: ${input.path}`);
        if (statSync(file).isDirectory()) {
          return readdirSync(file).join("\n");
        }
        if (statSync(file).size > READ_LIMIT_BYTES) {
          throw new Error(`${input.path} is too large to read (probably a binary asset)`);
        }
        return readFileSync(file, "utf8");
      }
      case "write_file": {
        const file = resolveInside(dirOf(), input.path);
        if (!WRITABLE_EXTENSIONS.has(path.extname(file).toLowerCase())) {
          throw new Error(
            `Only text files (${[...WRITABLE_EXTENSIONS].join(", ")}) can be written`,
          );
        }
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, input.content);
        return `Wrote ${input.path} (${input.content.length} chars)`;
      }
      case "export_showcase": {
        const out = await runExport(input.kind, input.showcaseId);
        return `Exported to ${out}`;
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };
}
