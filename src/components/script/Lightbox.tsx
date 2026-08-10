import { X } from "lucide-react";
import { useEffect } from "react";

type Props = {
  src: string;
  alt: string;
  kind: "image" | "video";
  onClose: () => void;
};

/** Full-screen preview of a slide's screenshot or video. */
export function Lightbox({ src, alt, kind, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-6 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="absolute right-5 top-5 rounded-full border border-border p-2 text-support transition-colors hover:text-foreground"
      >
        <X className="size-5" />
      </button>
      {kind === "video" ? (
        <video
          src={src}
          autoPlay
          loop
          muted
          playsInline
          className="max-h-full max-w-full rounded-2xl"
        />
      ) : (
        <img src={src} alt={alt} className="max-h-full max-w-full rounded-2xl object-contain" />
      )}
    </div>
  );
}
