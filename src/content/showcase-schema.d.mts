/** Type declarations for showcase-schema.mjs — see that file. */

export const SCENE_THEMES: readonly string[];
export const CAPTION_STYLES: readonly string[];
export const MEDIA_KINDS: readonly string[];
export const MEDIA_MOTIONS: readonly string[];
export const MEDIA_FRAMES: readonly string[];
export const MEDIA_ALIGNS: readonly string[];
export const MEDIA_FITS: readonly string[];
export const CTA_KINDS: readonly string[];
export const TRANSITIONS: readonly string[];
export const VOICEOVER_ENGINES: readonly string[];
export const TONEMAPS: readonly string[];

/** The JSON Schema for showcase.yaml. */
export const SHOWCASE_SCHEMA: Record<string, unknown>;

export type SchemaProblem = {
  /** unknown: a field that isn't one here; missing: a required field;
   *  type: the wrong kind of value; value: outside the field's choices
   *  or range. */
  kind: "unknown" | "missing" | "type" | "value";
  /** Where, as "scenes[2].take.clip". */
  path: string;
  message: string;
  /** Set on a problem inside a scene. */
  sceneIndex?: number;
};

export function checkShowcase(doc: unknown): SchemaProblem[];
