/** Type declarations for publish-rules.mjs — see that file. */

export type DestinationId = "tiktok" | "instagram" | "youtube";
export type PublishField = "caption" | "hashtags" | "title";

export type Destination = {
  label: string;
  uploadUrl: string;
  uploadHint: string;
  exportKind: string;
  fields: PublishField[];
  /** false when the platform's caption box drops pasted blank lines. */
  pasteBlankLines?: boolean;
  captionLimit: number;
  titleLimit?: number;
  maxHashtags?: number;
  maxSeconds: number;
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
