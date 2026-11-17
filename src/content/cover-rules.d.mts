/** Type declarations for cover-rules.mjs — see that file. */

export type CoverDestination = "tiktok" | "instagram" | "youtube" | "youtube43";
export type CoverLayout = "fade" | "band" | "split";
export type CoverFade = "light" | "medium" | "strong";
export type CoverTextPosition = "top" | "middle" | "bottom";
export type CoverTextSize = "s" | "m" | "l";
export type CoverFocus = "top" | "center" | "bottom" | "left" | "right";
export type CoverAnchor =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";
export type CoverField =
  "picture" | "focus" | "layout" | "fade" | "headline" | "textPosition" | "textSize" | "graphics";

export type CoverGraphic = { graphic: string; at: CoverAnchor; size: number };

/** One destination's cover, defaults filled in. */
export type ResolvedCoverFields = {
  picture?: string;
  focus: CoverFocus;
  layout: CoverLayout;
  fade: CoverFade;
  headline?: string;
  textPosition: CoverTextPosition;
  textSize: CoverTextSize;
  graphics: CoverGraphic[];
  /** The fields the destination sets itself. */
  overridden: CoverField[];
};

export type CoverImage = { width: number; height: number; format: "png" | "jpeg" };

export const COVER_DESTINATIONS: Record<CoverDestination, { label: string } & CoverImage>;
export const COVER_SIZE: { width: number; height: number };
export function coverImage(destination?: CoverDestination | null): CoverImage;
export function isLandscapeCover(destination?: CoverDestination | null): boolean;
export const COVER_GRID_CROP: number;
export const COVER_LENGTH_BADGE: { right: number; bottom: number; width: number; height: number };
export const COVER_SPLIT_TEXT_WIDTH: number;
export const COVER_LAYOUTS: CoverLayout[];
export const COVER_FADES: CoverFade[];
export const COVER_TEXT_POSITIONS: CoverTextPosition[];
export const COVER_TEXT_SIZES: CoverTextSize[];
export const COVER_FOCUS: CoverFocus[];
export const COVER_ANCHORS: CoverAnchor[];
export const GRAPHIC_SIZE: { min: number; max: number; default: number };
export const COVER_FIELDS: Record<CoverField, { type: string; description: string }>;
export const COVER_FIELD_NAMES: CoverField[];

export function coverValueProblem(name: string, value: unknown): string | null;
export function checkCover(doc: unknown): string[];
export function resolveCover(
  doc: unknown,
  destination?: CoverDestination,
  options?: { pictureRatio?: number | undefined },
): ResolvedCoverFields;
export function checkCoverEdit(edit: {
  destination?: string | null;
  name?: string;
  value?: unknown;
}): void;
export const COVER_SCHEMA: Record<string, unknown>;
