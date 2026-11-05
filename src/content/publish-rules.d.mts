/** Type declarations for publish-rules.mjs — see that file. */

export type DestinationId = "tiktok" | "instagram" | "youtube" | "youtube43";
export type PublishField = "caption" | "hashtags" | "title";

export type Destination = {
  label: string;
  /** The phone app a post is made from ("YouTube" for a Short too). */
  app: string;
  uploadUrl: string;
  uploadHint: string;
  /** The full-quality export this destination takes: "video" (9:16) or
   *  "video-43"; its draft is `${exportKind}-draft`. */
  exportKind: "video" | "video-43";
  /** What the platform calls the text box. */
  captionName: "caption" | "description";
  fields: PublishField[];
  /** false when the platform's caption box drops pasted blank lines. */
  pasteBlankLines?: boolean;
  captionLimit: number;
  titleLimit?: number;
  maxHashtags?: number;
  /** The longest video the platform takes; unset means any length. */
  maxSeconds?: number;
};

/** Where each field's text came from: the destination's own override,
 *  the publish default, the showcase's meta, or nowhere. */
export type TextSource = DestinationId | "publish" | "meta" | "none";

export type PostedText = {
  caption: string;
  hashtags: string[];
  title?: string;
  from: { caption: TextSource; hashtags: TextSource; title?: TextSource };
};

export const PUBLISH_FIELDS: readonly PublishField[];
export const DESTINATIONS: Record<DestinationId, Destination>;
export const DESTINATION_IDS: readonly DestinationId[];

export function destinationForView(view: string | null | undefined): DestinationId | null;

export function normalizeHashtag(value: unknown): string | null;
export function normalizeHashtags(value: unknown): string[];
export function publishText(
  publish: unknown,
  destination: DestinationId,
  meta?: { title?: unknown; description?: unknown },
): PostedText;
export function captionWithHashtags(
  posted: { caption: string; hashtags: string[] },
  destination?: DestinationId,
): string;
export function publishProblems(
  destination: DestinationId,
  posted: { caption: string; hashtags: string[]; title?: string },
  options?: { durationMs?: number },
): string[];
export function checkPublishEdit(edit: {
  destination?: string | null;
  name: string;
  value: unknown;
}): { remove: true } | { value: string | string[] };
