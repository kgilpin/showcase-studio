export type PlayerView = "tiktok" | "screens" | "embed";

export type ExportQuality = "draft" | "full";

export function exportKindFor(view: PlayerView, quality: ExportQuality): string;

export function exportLabel(kind: string): string;

export function exportPercent(job: { step?: number; steps?: number }): number | null;

export function fileManagerName(platform: string): string;
