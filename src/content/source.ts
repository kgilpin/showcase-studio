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
 *                  /showcases in this shape — see vite.config.ts); a
 *                  desktop shell can point it at a user folder instead.
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
  /** Asset key (file name without extension) → URL + display name. */
  assets: Map<string, ShowcaseAsset>;
  /** Graphic key → URL of the server-compiled component module. Empty for
   *  the bundled source, whose graphics are compiled into the app; the
   *  HTTP source serves folder TSX compiled on request (see
   *  src/content/graphics-runtime.tsx). */
  graphics: Map<string, string>;
};

export type ShowcaseSource = { load(): Promise<ShowcaseData[]> };

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

const assetModules = import.meta.glob("../../showcases/*/assets/*", {
  query: "?url",
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
      return {
        id,
        yaml,
        themeYaml,
        assets: assetMap(id, files),
        graphics: new Map<string, string>(),
      };
    });
    return Promise.resolve(data);
  },
};

type ShowcaseIndex = {
  showcases: { id: string; hasTheme: boolean; assets: string[]; graphics?: string[] }[];
};

export function httpSource(base: string): ShowcaseSource {
  const text = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load ${url} (${response.status})`);
    return response.text();
  };
  return {
    async load() {
      const index = JSON.parse(await text(`${base}/index.json`)) as ShowcaseIndex;
      return Promise.all(
        index.showcases.map(async ({ id, hasTheme, assets, graphics }) => ({
          id,
          yaml: await text(`${base}/${id}/showcase.yaml`),
          themeYaml: hasTheme ? await text(`${base}/${id}/theme.yaml`) : undefined,
          assets: assetMap(
            id,
            assets.map((name) => ({
              name,
              url: `${base}/${id}/assets/${name}`,
              file: `${id}/assets/${name}`,
            })),
          ),
          graphics: new Map(
            (graphics ?? []).map((name) => {
              const key = name.replace(/\.[^.]+$/, "");
              return [key, `${base}/${id}/graphics/${key}.js`];
            }),
          ),
        })),
      );
    },
  };
}

/** True when the app loads showcase data over HTTP instead of the bundle. */
export const dataMode = Boolean(import.meta.env["VITE_SHOWCASES_URL"]);

export function activeSource(): ShowcaseSource {
  const base = import.meta.env["VITE_SHOWCASES_URL"] as string | undefined;
  return base ? httpSource(base.replace(/\/$/, "")) : bundledSource;
}
