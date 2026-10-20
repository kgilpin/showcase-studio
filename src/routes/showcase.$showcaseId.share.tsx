import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ShareHandoff, type HandoffMethod } from "@/components/share/ShareHandoff";
import { ShareHistory } from "@/components/share/ShareHistory";
import { ShareText, type PublishEdit } from "@/components/share/ShareText";
import { ShareVideo, type Quality } from "@/components/share/ShareVideo";
import { ShowcaseNav } from "@/components/showcase/ShowcaseNav";
import { getShowcase } from "@/content/showcases";
import { DESTINATION_IDS, type DestinationId } from "@/content/publish-rules.mjs";
import { SubscribeDialog } from "@/components/studio/SubscribeDialog";
import { needsSubscription } from "@/components/studio/license-actions";
import { studio, useExportJob, useLicense, type ShareStatus } from "@/lib/studio";
import { cn } from "@/lib/utils";

/* The Share page: getting a showcase's video onto TikTok, Instagram and
 * YouTube Shorts, without the platforms' APIs. Pick a destination; the
 * page shows the video that destination takes (the full-quality 9:16
 * export or the draft, and whether each still matches the showcase), and
 * the steps to post it — from this computer or from the phone — with the
 * text it posts with edited right in the "copy the caption" step (saved
 * to showcase.yaml's publish: block). Everything comes
 * from the studio's share-status action (server/share.mjs), the same data
 * Claude's share_status tool returns. Studio only: sharing works on the
 * studio's exports. */
export const Route = createFileRoute("/showcase/$showcaseId/share")({
  head: ({ params }) => ({
    meta: [
      { title: `Share — ${getShowcase(params.showcaseId)?.title ?? params.showcaseId}` },
      { name: "description", content: "Post the showcase's video." },
    ],
  }),
  component: ShareScreen,
});

const remembered = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* A private window: the page just won't remember. */
  }
};

function ShareScreen() {
  const { showcaseId } = Route.useParams();
  const showcase = getShowcase(showcaseId);
  const [inStudio, setInStudio] = useState<boolean | null>(null);
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [destinationId, setDestinationId] = useState<DestinationId>("tiktok");
  /* How the user will post to this destination: their choice from last
   * time, or null until they make one. */
  const [method, setMethod] = useState<HandoffMethod | null>(null);
  /* Which export to post, once the user picks one; until then the page
   * picks (see `quality` below). */
  const [picked, setPicked] = useState<Quality | null>(null);
  /* Which destinations' captions were copied while the page was open. */
  const [copied, setCopied] = useState<Set<DestinationId>>(new Set());
  const job = useExportJob();
  const license = useLicense();
  const [subscribingFor, setSubscribingFor] = useState<string | null>(null);
  /* The showcase.yaml version the next text edit is made against, and
   * the edits waiting their turn: one edit at a time, each against the
   * version the one before it wrote, so two quick saves (the hashtags,
   * then the caption) never trip over each other. */
  const version = useRef<string | null>(null);
  const saves = useRef<Promise<unknown>>(Promise.resolve());

  const refresh = useCallback(async () => {
    const result = await studio()?.share.status(showcaseId);
    if (!result) return;
    if (result.ok && result.status) {
      version.current = result.status.version;
      setStatus(result.status);
      setLoadError(null);
    } else {
      setLoadError(result.error ?? "The studio didn't answer");
    }
  }, [showcaseId]);

  useEffect(() => {
    setInStudio(studio() != null);
    const saved = remembered("share-destination") as DestinationId | null;
    if (saved && DESTINATION_IDS.includes(saved)) setDestinationId(saved);
  }, []);
  useEffect(() => {
    const saved = remembered(`share-method:${destinationId}`);
    setMethod(saved === "phone" || saved === "computer" ? saved : null);
  }, [destinationId]);
  useEffect(() => {
    if (!inStudio) return;
    void refresh();
    /* An export finishing, or a file moved while the page was away. */
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const stop = studio()!.exports.onChange((changed) => {
      if (changed.showcaseId === showcaseId && changed.status !== "running") void refresh();
    });
    return () => {
      window.removeEventListener("focus", onFocus);
      stop();
    };
  }, [inStudio, refresh, showcaseId]);

  if (!showcase) return null; // the layout route renders the not-found message

  const destination = status?.destinations.find((d) => d.id === destinationId);
  const kind = destination?.exportKind ?? "video";
  const full = status?.exports[kind];
  const draft = status?.exports[`${kind}-draft`];
  /* The full-quality video when it's up to date; else a draft that is, so
   * the steps can be tried at once; else full quality, to export. */
  const quality: Quality = picked ?? (full?.current ? "full" : draft?.current ? "draft" : "full");
  const video = (quality === "draft" ? draft : full)?.current ?? null;
  const running =
    job?.status === "running" &&
    job.showcaseId === showcaseId &&
    (job.kind === kind || job.kind === `${kind}-draft`)
      ? job
      : null;
  const otherJob = job?.status === "running" && !running ? job : null;
  const canDrag = typeof window !== "undefined" && window.showcaseStudioShell?.startDrag != null;
  const canAirDrop = studio()?.info().features.airDrop === true;
  const pending =
    status?.handoffs.find((h) => h.destination === destinationId && !h.postUrl) ?? null;

  const pick = (id: DestinationId) => {
    setDestinationId(id);
    remember("share-destination", id);
  };
  const pickMethod = (value: HandoffMethod) => {
    setMethod(value);
    remember(`share-method:${destinationId}`, value);
  };
  const exportVideo = async (exportKind: string) => {
    /* No free videos left: the subscribe dialog first; it starts this
     * export once the payment lands. */
    if (needsSubscription(license, exportKind)) {
      setSubscribingFor(exportKind);
      return;
    }
    if (otherJob) {
      toast.error("Another export is running", {
        description: "One export runs at a time — wait for it, or cancel it.",
      });
      return;
    }
    setPicked(exportKind.endsWith("-draft") ? "draft" : "full");
    const result = await studio()!.exports.start(exportKind, showcaseId);
    if (!result.ok) toast.error("The export didn't start", { description: result.error });
  };
  const copy = async (text: string, what: string) => {
    const ok = await studio()!.share.copy(text);
    if (ok) {
      toast.success(`${what} copied`);
      setCopied((set) => new Set(set).add(destinationId));
    } else {
      toast.error("Couldn't copy", { description: "Select the text and copy it yourself." });
    }
  };
  const save = (edit: PublishEdit): Promise<string | null> => {
    const run = async () => {
      if (!version.current) return "Not loaded yet";
      setSaving(true);
      const result = await studio()!.scenes.edit({
        showcaseId,
        sceneId: "",
        baseHash: version.current,
        field: "publish.set",
        ...edit,
      });
      if (result.ok && result.hash) version.current = result.hash;
      await refresh();
      setSaving(false);
      if (result.ok) return null;
      toast.error("The text wasn't saved", { description: result.error });
      return result.error ?? "Not saved";
    };
    const next = saves.current.then(run, run);
    saves.current = next;
    return next;
  };
  const handOff = async (how: HandoffMethod) => {
    const result = await studio()!.share.handOff({
      showcaseId,
      destination: destinationId,
      method: how,
      quality,
    });
    if (!result.ok) toast.error("That didn't work", { description: result.error });
    await refresh();
  };
  const reveal = async (exportId: string) => {
    const result = await studio()!.share.reveal({ showcaseId, exportId });
    if (!result.ok) toast.error("Couldn't show the video", { description: result.error });
  };
  const postLink = async (url: string): Promise<string | null> => {
    const result = await studio()!.share.postLink({
      showcaseId,
      destination: destinationId,
      url,
      ...(pending ? { handoffId: pending.id } : {}),
    });
    if (!result.ok) return result.error ?? "Not saved";
    toast.success("Link saved");
    await refresh();
    return null;
  };
  const openPost = async (handoffId: string) => {
    const result = await studio()!.share.openPost({ showcaseId, handoffId });
    if (!result.ok) toast.error("Couldn't open the link", { description: result.error });
  };

  return (
    <main className="min-h-dvh w-full pb-14" style={{ background: "var(--gradient-stage)" }}>
      <ShowcaseNav
        showcaseId={showcaseId}
        title={showcase.title}
        current="share"
        built={showcase.builtMedia}
      />
      <div className="mx-auto box-content max-w-6xl px-4 sm:px-10">
        <header className="mt-8 border-b border-border pb-6">
          <p className="text-xs uppercase tracking-[0.42em] text-primary">Share</p>
          <h1 className="mt-4 font-display text-4xl leading-tight tracking-tight text-foreground sm:text-5xl">
            {showcase.title}
          </h1>
          <div role="tablist" aria-label="Destination" className="mt-6 flex flex-wrap gap-2">
            {DESTINATION_IDS.map((id) => {
              const label = status?.destinations.find((d) => d.id === id)?.label ?? id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={id === destinationId}
                  onClick={() => pick(id)}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-sm transition-colors",
                    id === destinationId
                      ? "border-primary bg-primary/15 text-foreground"
                      : "border-border text-foreground/60 hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </header>

        {inStudio === false && (
          <p className="mt-10 text-sm text-support">
            Sharing needs the studio: open this showcase in Showcase Studio.
          </p>
        )}
        {loadError && <p className="mt-10 text-sm text-red-400">{loadError}</p>}

        {status && destination && full && draft && (
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <div className="space-y-6">
              <ShareVideo
                videoUrl={(id) => studio()!.share.videoUrl(showcaseId, id)}
                full={full}
                draft={draft}
                quality={quality}
                job={running}
                onQuality={setPicked}
                onExport={(exportKind) => void exportVideo(exportKind)}
                onCancel={(jobId) => void studio()!.exports.cancel(jobId)}
              />
              <ShareHistory handoffs={status.handoffs} onOpen={(id) => void openPost(id)} />
              <SubscribeDialog
                open={subscribingFor != null}
                onOpenChange={(open) => !open && setSubscribingFor(null)}
                onUnlocked={() => subscribingFor && void exportVideo(subscribingFor)}
              />
            </div>
            <ShareHandoff
              destination={destination}
              video={video}
              quality={quality}
              method={method}
              canAirDrop={canAirDrop}
              canDrag={canDrag}
              text={
                <ShareText
                  destination={destination}
                  saving={saving}
                  onSave={save}
                  onCopy={(text, what) => void copy(text, what)}
                />
              }
              copied={copied.has(destinationId)}
              pending={pending}
              onMethod={pickMethod}
              onHandOff={(how) => void handOff(how)}
              onReveal={(id) => void reveal(id)}
              onDrag={(file) => window.showcaseStudioShell?.startDrag?.(file)}
              onPostLink={postLink}
            />
          </div>
        )}
      </div>
    </main>
  );
}
