import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Play } from "lucide-react";
import { captionTimeline, getShowcase, useShowcase } from "@/content/showcases";
import { dataMode } from "@/content/source";
import { commitEdit, useCanEditScenes, useEditShortcuts } from "@/lib/edits";
import { EditableText } from "@/components/studio/EditableText";
import { SharePrompter } from "@/components/studio/SharePrompter";
import { DiagnosticsTray } from "@/components/showcase/DiagnosticsTray";
import { HomeBackNav } from "@/components/showcase/HomeBackNav";
import { ShowcaseNav } from "@/components/showcase/ShowcaseNav";
import { MediaThumb } from "@/components/script/MediaThumb";
import { ScriptPlayer } from "@/components/script/ScriptPlayer";

export const Route = createFileRoute("/showcase/$showcaseId/script")({
  /* `?record=1` opens straight into the teleprompter in record mode: paused
   * until window.__record.start(), plays once, then flags done — so
   * `npm run export:video -- --prompter <id>` can capture it as a video. */
  validateSearch: (search: Record<string, unknown>): { record?: boolean } =>
    search["record"] === 1 || search["record"] === "1" || search["record"] === true
      ? { record: true }
      : {},
  head: ({ params }) => {
    const showcase = getShowcase(params.showcaseId);
    const title = showcase ? `Script — ${showcase.title}` : "Script";
    return {
      meta: [
        { title },
        {
          name: "description",
          content: "Slide-by-slide script: timings, captions, screenshots and narration copy.",
        },
      ],
    };
  },
  component: ScriptScreen,
});

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function ScriptScreen() {
  const { showcaseId } = Route.useParams();
  const { record } = Route.useSearch();
  /* Subscribed, not just read: in-app edits rebuild the showcase in
   * place and this listing must re-render without a page reload. */
  const showcase = useShowcase(showcaseId);
  const [prompter, setPrompter] = useState(false);
  /* Studio editing: the title and every caption line are click-to-edit
   * (this page is the script editor — captions are transient in the
   * player). Cmd/Ctrl+Z undoes committed edits. */
  const canEdit = useCanEditScenes();
  useEditShortcuts(showcaseId);
  if (!showcase) return null; // the layout route renders the not-found message

  const scenes = showcase.scenes;
  const total = scenes.reduce((sum, s) => sum + s.durationMs, 0);
  let runningStart = 0;

  if (record) return <ScriptPlayer scenes={scenes} record onExit={() => {}} />;
  if (prompter)
    return (
      <ScriptPlayer scenes={scenes} takeName={showcase.id} onExit={() => setPrompter(false)} />
    );

  return (
    <main
      className="min-h-dvh w-full px-6 py-14 sm:px-10"
      style={{ background: "var(--gradient-stage)" }}
    >
      <div className="mx-auto max-w-4xl">
        <HomeBackNav />
        <ShowcaseNav showcaseId={showcaseId} current="script" />

        <header className="mt-8 border-b border-border pb-8">
          <p className="text-xs uppercase tracking-[0.42em] text-primary">Script</p>
          {/* The page's one action sits with the title — filled primary
           * marks "does something" (nav pills stay outlined). */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
            <h1 className="font-display text-5xl leading-tight tracking-tight text-foreground">
              {showcase.title}
            </h1>
            <div className="flex flex-wrap items-center gap-3">
              <SharePrompter showcaseId={showcase.id} />
              <button
                type="button"
                onClick={() => setPrompter(true)}
                className="inline-flex items-center gap-2 rounded-full border border-transparent bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85"
              >
                <Play className="size-4" /> Play script
              </button>
            </div>
          </div>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            {showcase.description}
          </p>
          <p className="mt-6 text-sm text-support">
            {scenes.length} slides · {seconds(total)} total ·{" "}
            {showcase.loop ? "loops" : "plays once"} · soundtrack{" "}
            {showcase.soundtrack.src ? "set" : "not set"} at{" "}
            {Math.round(showcase.soundtrack.volume * 100)}% volume · edit{" "}
            <code className="text-foreground/80">
              {dataMode ? "" : "showcases/"}
              {showcase.id}/showcase.yaml
            </code>
          </p>
        </header>

        <ol className="mt-10 space-y-8">
          {scenes.map((scene, i) => {
            const start = runningStart;
            runningStart += scene.durationMs;
            const timeline = captionTimeline(scene);
            const media = scene.media;

            return (
              <li key={scene.id} className="rounded-2xl border border-border bg-card/40 p-6 sm:p-8">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.32em] text-support">
                    Slide {i + 1} · {scene.theme} · {scene.id}
                  </p>
                  <p className="text-xs tabular-nums text-support">
                    {seconds(start)} → {seconds(start + scene.durationMs)} ·{" "}
                    <span className="text-foreground/80">{seconds(scene.durationMs)}</span>
                  </p>
                </div>

                <div className="mt-5 flex flex-col gap-6 sm:flex-row">
                  {media.kind === "graphic" && (
                    <div className="flex w-28 shrink-0 flex-col gap-2">
                      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-lg border border-border bg-card">
                        <media.component />
                      </div>
                      <p className="break-all text-[0.65rem] leading-snug text-support">
                        {media.file ?? media.graphic}
                      </p>
                    </div>
                  )}
                  {media.kind !== "none" && media.kind !== "graphic" && (
                    <div className="flex w-28 shrink-0 flex-col gap-4">
                      <MediaThumb
                        src={media.src}
                        alt={media.alt}
                        kind={media.kind}
                        caption={media.file ?? media.asset}
                      />
                      {media.fadeTo && (
                        <MediaThumb
                          src={media.fadeTo.src}
                          alt={media.fadeTo.alt}
                          kind="image"
                          caption={`fades to ${media.fadeTo.file ?? media.fadeTo.asset}`}
                        />
                      )}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    {scene.eyebrow && (
                      <p className="text-xs uppercase tracking-[0.42em] text-primary">
                        {scene.eyebrow}
                      </p>
                    )}
                    {/* While editable, a missing title still gets the
                     * editor (ghost "Add a title") — except on footage,
                     * which never shows titles. */}
                    {canEdit && scene.theme !== "footage" ? (
                      <EditableText
                        as="h2"
                        value={scene.title ?? ""}
                        onCommit={(value) =>
                          void commitEdit(showcase.id, scene.id, { field: "title", value })
                        }
                        label="Click to edit the title"
                        placeholder="Add a title"
                        className="mt-3 font-display text-2xl leading-snug tracking-tight text-foreground"
                      />
                    ) : (
                      scene.title && (
                        <h2 className="mt-3 font-display text-2xl leading-snug tracking-tight text-foreground">
                          {scene.title}
                        </h2>
                      )
                    )}
                    {scene.warnings && (
                      <ul className="mt-3 space-y-1 text-xs leading-relaxed text-amber-400/90">
                        {scene.warnings.map((warning, wi) => (
                          <li key={wi}>⚠ {warning}</li>
                        ))}
                      </ul>
                    )}

                    {timeline.length > 0 && (
                      <ul className="mt-5 space-y-3">
                        {timeline.map((caption, ci) => (
                          <li key={ci} className="flex gap-4">
                            <span className="w-24 shrink-0 pt-0.5 text-[0.7rem] tabular-nums text-support">
                              {seconds(caption.startMs)}–{seconds(caption.endMs)}
                            </span>
                            <span className="text-sm leading-relaxed text-muted-foreground">
                              {canEdit ? (
                                <EditableText
                                  value={caption.text}
                                  onCommit={(value) =>
                                    void commitEdit(showcase.id, scene.id, {
                                      field: "caption",
                                      captionIndex: ci,
                                      value,
                                    })
                                  }
                                  label="Click to edit this caption"
                                />
                              ) : (
                                caption.text
                              )}
                              {caption.durationMs !== scene.durationMs && (
                                <span className="ml-2 text-[0.7rem] text-support">
                                  ({seconds(caption.durationMs)})
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {scene.support && (
                      <p className="mt-5 text-sm leading-relaxed text-support">{scene.support}</p>
                    )}
                    {scene.cta && (
                      <p className="mt-5 text-sm text-support">
                        CTA: {scene.cta.label} — {scene.cta.url}
                      </p>
                    )}
                    {media.kind !== "none" && (
                      <p className="mt-5 text-xs leading-relaxed text-support">
                        {media.kind} · {media.motion ?? "zoom-in"} · {media.frame ?? "phone"} ·{" "}
                        {media.alt}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="fixed inset-x-0 bottom-0">
        <DiagnosticsTray />
      </div>
    </main>
  );
}
