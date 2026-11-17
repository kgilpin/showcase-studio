/* =============================================================
 * SHOWCASE SOURCE — where the showcase data comes from.
 *
 * A source delivers each showcase's raw data (showcase.yaml, theme.yaml,
 * asset URLs); src/content/showcases.ts turns that into the resolved
 * Showcase model. Two implementations:
 *
 *   bundledSource  the default — showcase folders under showcases/
 *                  compiled into the app at build time via import.meta.glob.
 *                  Synchronous data, SSR-safe, no deploy changes.
 *   httpSource     the same folders served as plain files over HTTP:
 *                  <base>/index.json, <base>/<id>/showcase.yaml,
 *                  <base>/<id>/assets/<file>. Selected by setting
 *                  VITE_SHOWCASES_URL (the vite dev server serves
 *                  /showcase-data in this shape — see vite.config.ts); a
 *                  desktop shell can point it at a user folder instead.
 *                  It can also re-read one showcase (loadOne), which is
 *                  how a change on disk reaches the page without a
 *                  reload (src/lib/live-updates.ts). Every studio mode
 *                  sets VITE_SHOWCASES_URL to /showcase-data, which the
 *                  studio server serves from the library folder.
 *
 * A page opened with ?snapshot=<id> (a video export's record page) reads
 * the export's copy of the showcase from /showcase-data-snapshot/<id>/
 * instead (server/export-snapshot.mjs).
 *
 * TSX graphics travel both ways: the bundled source compiles repo
 * graphics into the app, and the HTTP source lists folder graphics that
 * the data server compiles on request (loaded lazily by
 * src/content/graphics-runtime.tsx; the folder wins when both exist).
 * ============================================================= */

export type ShowcaseAsset = { url: string; file: string };

/** One showcase's raw data as delivered by a source. */
export type ShowcaseData = {
  id: string;
  /** showcase.yaml text. */
  yaml: string;
  /** theme.yaml text, when the showcase has one. */
  themeYaml?: string | undefined;
  /** cover.yaml text, when the showcase has a cover. */
  coverYaml?: string | undefined;
  /** Asset key (file name without extension) → URL + display name. */
  assets: Map<string, ShowcaseAsset>;
  /** Voiceover word-timestamp sidecars: `assets/<name>.words.json` raw
   *  text, keyed by `<name>` (the audio's asset key). Used to sync
   *  worded caption styles exactly to a recorded voiceover. */
  words: Map<string, string>;
  /** Graphic key → URL of the server-compiled component module. Empty for
   *  the bundled source, whose graphics are compiled into the app; the
   *  HTTP source serves folder TSX compiled on request (see
   *  src/content/graphics-runtime.tsx). */
  graphics: Map<string, string>;
  /** When showcase.yaml last changed (ms since the epoch). The HTTP
   *  source has it from the server; the bundled source has no file
   *  times, so its showcases sort by title alone. */
  modifiedMs?: number | undefined;
};

export type ShowcaseSource = {
  /** Every showcase in the library. */
  load(): Promise<ShowcaseData[]>;
  /** One showcase, re-read after its files changed on disk (the
   *  studio's "showcase-changed" event); null when the library no longer
   *  has it. Only the HTTP source has it: the bundle can't change. */
  loadOne?(id: string): Promise<ShowcaseData | null>;
};

/** Builds the key→asset map. Every file is reachable by its full name;
 *  the bare name (without extension) is a convenience key. When two files
 *  share a bare name (say a .mov and an .MP3), the first keeps it and the
 *  others stay reachable by full file name — a warning, not a failure. */
function assetMap(showcaseId: string, files: { name: string; url: string; file: string }[]) {
  const assets = new Map<string, ShowcaseAsset>();
  for (const { name, url, file } of files) {
    if (!assets.has(name)) assets.set(name, { url, file });
    const key = name.replace(/\.[^.]+$/, "");
    if (key === name) continue;
    const existing = assets.get(key);
    if (!existing) {
      assets.set(key, { url, file });
    } else if (existing.file !== file) {
      console.warn(
        `Showcase "${showcaseId}": several assets share the name "${key}" — ` +
          `"${key}" resolves to ${existing.file}; reference the others by full file name.`,
      );
    }
  }
  return assets;
}

const yamlModules = import.meta.glob("../../showcases/*/showcase.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const themeModules = import.meta.glob("../../showcases/*/theme.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const coverModules = import.meta.glob("../../showcases/*/cover.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const assetModules = import.meta.glob("../../showcases/*/assets/*", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const wordsModules = import.meta.glob("../../showcases/*/assets/*.words.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const bundledSource: ShowcaseSource = {
  load() {
    const data = Object.entries(yamlModules).map(([yamlPath, yaml]) => {
      const id = yamlPath.split("/").at(-2)!;
      const files = Object.entries(assetModules)
        .filter(([path]) => path.split("/").at(-3) === id)
        .map(([path, url]) => {
          const name = path.split("/").at(-1)!;
          return { name, url, file: `showcases/${id}/assets/${name}` };
        });
      const themeYaml = Object.entries(themeModules).find(
        ([path]) => path.split("/").at(-2) === id,
      )?.[1];
      const coverYaml = Object.entries(coverModules).find(
        ([path]) => path.split("/").at(-2) === id,
      )?.[1];
      const words = new Map(
        Object.entries(wordsModules)
          .filter(([path]) => path.split("/").at(-3) === id)
          .map(([path, json]) => [
            path
              .split("/")
              .at(-1)!
              .replace(/\.words\.json$/, ""),
            json,
          ]),
      );
      return {
        id,
        yaml,
        themeYaml,
        coverYaml,
        assets: assetMap(id, files),
        words,
        graphics: new Map<string, string>(),
      };
    });
    return Promise.resolve(data);
  },
};

type ShowcaseIndexEntry = {
  id: string;
  hasTheme: boolean;
  hasCover?: boolean;
  assets: string[];
  graphics?: string[];
  modifiedMs?: number;
  /** Each asset's and graphic's modified time, keyed by its path in the
   *  showcase folder ("assets/voiceover.m4a"); see showcase-data.mjs. */
  versions?: Record<string, number>;
};

type ShowcaseIndex = { showcases: ShowcaseIndexEntry[] };

export function httpSource(base: string): ShowcaseSource {
  const text = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load ${url} (${response.status})`);
    return response.text();
  };
  /* A file's URL carries its modified time, so a file the studio
   * rebuilds under the same name — the voiceover after a caption edit, a
   * clip after a re-cut — is a new URL: the audio element and the
   * graphics module cache fetch it instead of keeping the old one. The
   * server ignores the query. */
  const versioned = (url: string, versions: Record<string, number> | undefined, file: string) =>
    versions?.[file] != null ? `${url}?v=${versions[file]}` : url;
  const load = async ({
    id,
    hasTheme,
    hasCover,
    assets,
    graphics,
    modifiedMs,
    versions,
  }: ShowcaseIndexEntry): Promise<ShowcaseData> => ({
    id,
    modifiedMs,
    yaml: await text(`${base}/${id}/showcase.yaml`),
    themeYaml: hasTheme ? await text(`${base}/${id}/theme.yaml`) : undefined,
    coverYaml: hasCover ? await text(`${base}/${id}/cover.yaml`) : undefined,
    assets: assetMap(
      id,
      assets.map((name) => ({
        name,
        url: versioned(`${base}/${id}/assets/${name}`, versions, `assets/${name}`),
        file: `${id}/assets/${name}`,
      })),
    ),
    words: new Map(
      await Promise.all(
        assets
          .filter((name) => name.endsWith(".words.json"))
          .map(
            async (name) =>
              [
                name.replace(/\.words\.json$/, ""),
                await text(versioned(`${base}/${id}/assets/${name}`, versions, `assets/${name}`)),
              ] as const,
          ),
      ),
    ),
    graphics: new Map(
      (graphics ?? []).map((name) => {
        const key = name.replace(/\.[^.]+$/, "");
        return [key, versioned(`${base}/${id}/graphics/${key}.js`, versions, `graphics/${name}`)];
      }),
    ),
  });
  const index = async () => JSON.parse(await text(`${base}/index.json`)) as ShowcaseIndex;
  return {
    async load() {
      return Promise.all((await index()).showcases.map(load));
    },
    async loadOne(id) {
      const entry = (await index()).showcases.find((showcase) => showcase.id === id);
      return entry ? load(entry) : null;
    },
  };
}

/** True when the app loads showcase data over HTTP instead of the bundle. */
export const dataMode = Boolean(import.meta.env["VITE_SHOWCASES_URL"]);

export function activeSource(): ShowcaseSource {
  const base = import.meta.env["VITE_SHOWCASES_URL"] as string | undefined;
  if (!base) return bundledSource;
  /* A relative base (the packaged shell's front door) only resolves in
   * the browser. Every route is client-only, so during SSR serve an
   * empty library instead of a fetch that has no origin to go to. */
  if (base.startsWith("/") && typeof window === "undefined") {
    return { load: () => Promise.resolve([]) };
  }
  const root = base.replace(/\/$/, "");
  /* A page opened with ?snapshot=<id> is an export's: it reads the copy
   * of the showcase the studio took when the export started
   * (server/export-snapshot.mjs), served beside the library at
   * <base>-snapshot/<id>, so an edit made while the frames render never
   * reaches it. A re-read of a showcase (the "showcase-changed" event)
   * finds the copy unchanged. */
  const snapshot = exportSnapshotId();
  return httpSource(snapshot ? `${root}-snapshot/${snapshot}` : root);
}

/** The export snapshot this page reads from, from its URL; undefined on
 *  every ordinary page. */
export function exportSnapshotId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const id = new URLSearchParams(window.location.search).get("snapshot");
  return id && /^[0-9]+-[A-Za-z0-9_-]+$/.test(id) ? id : undefined;
}
