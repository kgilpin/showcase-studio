import { useState } from "react";
import { Lightbox } from "./Lightbox";

type Props = {
  src: string;
  alt: string;
  kind: "image" | "video";
  caption?: string | undefined;
};

/** Clickable slide thumbnail that opens a full-screen preview. */
export function MediaThumb({ src, alt, kind, caption }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full overflow-hidden rounded-lg border border-border transition-opacity hover:opacity-80"
      >
        {kind === "video" ? (
          <video src={src} muted playsInline className="w-full object-cover" />
        ) : (
          <img src={src} alt={alt} loading="lazy" className="w-full object-cover" />
        )}
      </button>
      {caption && (
        <p className="mt-2 break-all text-[0.65rem] leading-snug text-support">{caption}</p>
      )}
      {open && <Lightbox src={src} alt={alt} kind={kind} onClose={() => setOpen(false)} />}
    </div>
  );
}
