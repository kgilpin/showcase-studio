/* The Share page's hand-off: the steps from "the video is ready" to "it's
 * posted", for one destination, as a checklist that ticks off as you go.
 * Step 3 asks how you'll post it, and the steps after it follow the
 * answer. The page remembers the answer for each destination, so it is
 * already chosen next time — but it stays a step you can see and change.
 *
 *   1 ✓ The video is up to date
 *   2 ✓ Write and copy the caption
 *   3 ✓ How will you post it?   [ From this computer ]  [ From your phone ]
 *
 *   From this computer                  From your phone (a Mac: AirDrop)
 *   4 ✓ Show the video in Finder        4 → AirDrop the video
 *   5 → Open the upload page            5   Open the app, pick it, paste, post
 *   6   Drag the video in, paste, post  6   Paste the post link
 *   7   Paste the post link
 *
 * Finder comes first, so the video is already on screen when the upload
 * page opens. The file manager, the upload page and AirDrop are opened by
 * the studio server, on the studio's machine, so all three work the same
 * in the desktop app, a browser and Claude Code's preview. The desktop
 * app can also drag the video straight out of the page. Nothing is posted
 * for the user: the platform's own page (or app) does that. */
import { useState } from "react";
import { Check, ExternalLink, FolderOpen, GripVertical, Monitor, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fileManagerName } from "@/lib/export-kinds.mjs";
import type { DestinationId } from "@/content/publish-rules.mjs";
import type { ShareDestination, ShareExport, ShareHandoff as Handoff } from "@/lib/studio";
import { cn } from "@/lib/utils";

export type HandoffMethod = "computer" | "phone";

/* How a post's link starts on each platform, for the link box's hint. */
const POST_LINK_EXAMPLE: Record<DestinationId, string> = {
  tiktok: "tiktok.com",
  instagram: "instagram.com",
  youtube: "youtube.com/shorts",
  youtube43: "youtube.com/watch",
};

function Step({ n, done, children }: { n: number; done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
          done
            ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-400"
            : "border-border text-support",
        )}
        aria-hidden="true"
      >
        {done ? <Check className="size-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2 text-sm text-foreground">{children}</div>
    </li>
  );
}

export function ShareHandoff({
  destination,
  video,
  quality,
  method,
  canAirDrop,
  canDrag,
  text,
  copied,
  pending,
  onMethod,
  onHandOff,
  onReveal,
  onDrag,
  onPostLink,
}: {
  destination: ShareDestination;
  /** The current full-quality export, or null when there is none. */
  video: ShareExport | null;
  /** Which export this post uses (the Video card's choice). */
  quality: "full" | "draft";
  /** How the user will post, or null until they choose. */
  method: HandoffMethod | null;
  canAirDrop: boolean;
  canDrag: boolean;
  /** The caption was copied since the page opened this destination. */
  copied: boolean;
  /** The text editor (ShareText), shown in the "copy the caption" step. */
  text: React.ReactNode;
  /** The newest hand-off to this destination still waiting for its link. */
  pending: Handoff | null;
  onMethod(method: HandoffMethod): void;
  onHandOff(method: HandoffMethod): void;
  onReveal(exportId: string): void;
  onDrag(file: string): void;
  /** Saves the post link; resolves with an error message, or null. */
  onPostLink(url: string): Promise<string | null>;
}) {
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  /* The video was shown in the file manager (step 3 ticks). */
  const [revealed, setRevealed] = useState(false);
  const manager = typeof navigator === "undefined" ? "folder" : fileManagerName(navigator.platform);
  const ready = video != null;
  const handedOff = pending != null;
  const label = destination.label;
  /* The site and phone app's name: a Short is posted on YouTube. */
  const appName = destination.app;
  const fourThree = destination.exportKind === "video-43";

  const saveLink = async () => {
    const error = await onPostLink(link);
    setLinkError(error);
    if (!error) setLink("");
  };

  return (
    <section
      aria-label="Hand-off"
      className="@container rounded-2xl border border-border bg-card/40 p-5"
    >
      <p className="text-xs uppercase tracking-[0.3em] text-support">Post it</p>

      <ol className="mt-5 space-y-4">
        <Step n={1} done={ready}>
          <p>
            {ready
              ? quality === "draft"
                ? `The ${fourThree ? "4:3 " : ""}draft is up to date — fine for trying the steps.`
                : `The full-quality ${fourThree ? "4:3 " : ""}video is up to date.`
              : `Export the ${fourThree ? "4:3 " : ""}${quality === "draft" ? "draft" : "full-quality video"} first (see Video).`}
          </p>
        </Step>

        <Step n={2} done={copied}>
          <p>
            Write the {destination.captionName === "description" ? "title, description" : "caption"}{" "}
            and hashtags, then copy them.
          </p>
          {text}
          {method === "phone" && (
            <p className="text-xs text-support">
              On a Mac with an iPhone signed in to the same Apple Account, the copy reaches the
              phone&apos;s clipboard too.
            </p>
          )}
        </Step>

        <Step n={3} done={method != null}>
          <p>How will you post it?</p>
          <div role="radiogroup" aria-label="How to post" className="grid gap-2 @md:grid-cols-2">
            {(
              [
                [
                  "computer",
                  "From this computer",
                  `Upload it on ${appName}'s website, in your browser.`,
                ],
                [
                  "phone",
                  "From your phone",
                  canAirDrop
                    ? `AirDrop the video to your phone and post it in the ${appName} app.`
                    : `Send the video to your phone and post it in the ${appName} app.`,
                ],
              ] as const
            ).map(([value, title, detail]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={method === value}
                onClick={() => onMethod(value)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors",
                  method === value
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50 hover:bg-card/70",
                )}
              >
                <span className="flex items-center gap-2 text-sm text-foreground">
                  {value === "computer" ? (
                    <Monitor className="size-4 text-primary" aria-hidden="true" />
                  ) : (
                    <Smartphone className="size-4 text-primary" aria-hidden="true" />
                  )}
                  {title}
                </span>
                <span className="text-xs text-support">{detail}</span>
              </button>
            ))}
          </div>
        </Step>

        {method === "computer" ? (
          <>
            <Step n={4} done={revealed}>
              <p>Show the video in {manager === "folder" ? "its folder" : manager}.</p>
              <Button
                size="sm"
                variant={revealed ? "outline" : "default"}
                disabled={!ready}
                onClick={() => {
                  if (!video) return;
                  setRevealed(true);
                  onReveal(video.id);
                }}
              >
                <FolderOpen /> Show in {manager}
              </Button>
            </Step>
            <Step n={5} done={handedOff}>
              <p>Open {destination.uploadHint}.</p>
              <Button
                size="sm"
                variant={handedOff ? "outline" : "default"}
                disabled={!ready}
                onClick={() => onHandOff("computer")}
              >
                <ExternalLink /> Open {label} upload
              </Button>
              <p className="text-xs text-support">It opens in your web browser.</p>
            </Step>
            <Step n={6} done={false}>
              <p>
                Drag the video from {manager === "folder" ? "the folder" : manager} onto the upload
                page, paste the caption, and post.
              </p>
              {ready && canDrag && (
                <div
                  draggable
                  onDragStart={(e) => {
                    e.preventDefault();
                    onDrag(video.file);
                  }}
                  title="Or drag it from here"
                  className="inline-flex cursor-grab items-center gap-2 rounded-md border border-dashed border-primary/60 bg-primary/10 px-3 py-1.5 text-xs active:cursor-grabbing"
                >
                  <GripVertical className="size-4 text-primary" aria-hidden="true" />
                  Or drag it from here
                </div>
              )}
            </Step>
          </>
        ) : method === "phone" ? (
          <>
            <Step n={4} done={handedOff}>
              {canAirDrop ? (
                <>
                  <p>AirDrop the video to your phone. It saves to Photos.</p>
                  <Button size="sm" disabled={!ready} onClick={() => onHandOff("phone")}>
                    <Smartphone /> AirDrop the video
                  </Button>
                </>
              ) : (
                <>
                  <p>
                    Send the video to your phone. This computer has no AirDrop, so use what you
                    already have — Quick Share, Phone Link, KDE Connect.
                  </p>
                  {ready && (
                    <Button variant="outline" size="sm" onClick={() => onReveal(video.id)}>
                      <FolderOpen /> Show in {manager}
                    </Button>
                  )}
                </>
              )}
            </Step>
            <Step n={5} done={false}>
              <p>On the phone, open {appName}, pick the video, paste the caption, and post.</p>
            </Step>
          </>
        ) : null}

        {method != null && (
          <Step n={method === "computer" ? 7 : 6} done={false}>
            <p>Paste the post&apos;s link to keep it with this showcase (optional).</p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void saveLink();
              }}
            >
              <Input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder={`https://${POST_LINK_EXAMPLE[destination.id]}/…`}
                aria-label="Post link"
                aria-invalid={linkError != null}
              />
              <Button type="submit" variant="secondary" disabled={!link.trim()}>
                Save
              </Button>
            </form>
            {linkError && <p className="text-xs text-red-400">{linkError}</p>}
          </Step>
        )}
      </ol>
    </section>
  );
}
