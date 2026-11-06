export type PlayerView = "tiktok" | "screens" | "embed";

export const PLAYER_VIEWS: readonly PlayerView[];
export const VIEW_LABELS: Record<PlayerView, string>;
export function playerView(value: unknown): PlayerView | null;

export type ExportQuality = "draft" | "full";

export function exportKindFor(view: PlayerView, quality: ExportQuality): string;

export const VIDEO_FORMATS: Record<
  "video" | "video-draft" | "video-43" | "video-43-draft",
  { width: number; height: number; fps: number }
>;

export function exportLabel(kind: string): string;

export function exportPercent(job: { step?: number; steps?: number }): number | null;

export function fileManagerName(platform: string): string;
