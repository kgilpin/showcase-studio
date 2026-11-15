import { useEffect, useState } from "react";
import { coverFor, type ResolvedCover, type Showcase } from "@/content/showcases";
import type { CoverDestination } from "@/content/cover-rules.mjs";

/* A showcase's cover for one destination, as every page draws it. The
 * layout can depend on the picture's shape (a portrait picture at 16:9 is
 * split when cover.yaml sets no layout), which is only known once the
 * picture loads, so the cover is resolved twice: first to find the
 * picture, then with its shape. `ready` is false until then, so the saved
 * image (/cover/still) never captures the first guess. */
export function useCover(
  showcase: Showcase | undefined,
  destination: CoverDestination | undefined,
): { cover: ResolvedCover | undefined; pictureRatio: number | undefined; ready: boolean } {
  const first = showcase ? coverFor(showcase, destination) : undefined;
  const measured = usePictureRatio(first?.pictureUrl);
  const pictureRatio = measured ?? undefined;
  return {
    cover: showcase && pictureRatio ? coverFor(showcase, destination, pictureRatio) : first,
    pictureRatio,
    ready: !first?.pictureUrl || measured !== undefined,
  };
}

/** The picture's width over its height once it has loaded; null when it
 *  can't load; undefined until then, or with no picture. */
function usePictureRatio(url: string | undefined): number | null | undefined {
  const [measured, setMeasured] = useState<{ url: string; ratio: number | null }>();
  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    const image = new Image();
    image.onload = () => {
      if (live) {
        setMeasured({
          url,
          ratio: image.naturalHeight ? image.naturalWidth / image.naturalHeight : null,
        });
      }
    };
    image.onerror = () => {
      if (live) setMeasured({ url, ratio: null });
    };
    image.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return url && measured?.url === url ? measured.ratio : undefined;
}
