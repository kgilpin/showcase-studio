import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ImagePlus, Play, Plus, Trash2, X } from "lucide-react";
import {
  captionTimeline,
  getShowcase,
  isOutline,
  useShowcase,
  type Scene,
} from "@/content/showcases";
import { dataMode } from "@/content/source";
import { commitEdit, useCanEditScenes, useEditShortcuts } from "@/lib/edits";
import { EditableText } from "@/components/studio/EditableText";
import { MediaPicker } from "@/components/studio/MediaPicker";
import { SharePrompter } from "@/components/studio/SharePrompter";
import { DiagnosticsTray } from "@/components/showcase/DiagnosticsTray";
import { ShowcaseFrame } from "@/components/showcase/ShowcaseFrame";
import { GraphicThumb } from "@/components/script/GraphicThumb";
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
  /* One picker for the whole page: the scene whose media is being
   * chosen from the assets library. */
  const [pickerScene, setPickerScene] = useState<Scene | null>(null);
  if (!showcase) return null; // the layout route renders the not-found message

  const scenes = showcase.scenes;
  const total = scenes.reduce((sum, s) => sum + s.durationMs, 0);
  let runningStart = 0;

  /* A fresh slide, inserted at `index` with a unique id — one editable
   * caption, no media yet. */
  const addSlide = (index: number) => {
    const existing = new Set(scenes.map((s) => s.id));
    let n = scenes.length + 1;
    while (existing.has(`slide-${n}`)) n += 1;
    const id = `slide-${n}`;
    void commitEdit(showcase.id, id, {
      field: "scene.insert",
      index,
      scene: {
        id,
        theme: "statement",
        title: "New slide",
        captions: [{ text: "New caption" }],
        media: { kind: "none" },
      },
    });
  };

  if (record) return <ScriptPlayer scenes={scenes} record onExit={() => {}} />;
  if (prompter)
    return (
      <ScriptPlayer scenes={scenes} takeName={showcase.id} onExit={() => setPrompter(false)} />
    );

  return (
    <ShowcaseFrame
      showcaseId={showcaseId}
      title={showcase.title}
      current="script"
      className="pb-14"
    >
      <div className="mx-auto box-content max-w-4xl px-6 sm:px-10">
        <header className="mt-8 border-b border-border pb-8">
          <p className="text-xs uppercase tracking-[0.42em] text-primary">Script</p>
          {/* The page's one action sits with the title — filled primary
           * marks "does something" (the tabs stay plain). */}
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
            {showcase.soundtrack?.src
              ? `at ${Math.round(showcase.soundtrack.volume * 100)}% volume`
              : "not set"}{" "}
            · edit{" "}
            <code className="text-foreground/80">
              {dataMode ? "" : "showcases/"}
              {showcase.id}/showcase.yaml
            </code>
          </p>
          {showcase.notes && (
            <p className="mt-4 whitespace-pre-line border-l-2 border-border pl-3 text-xs leading-relaxed text-support">
              {showcase.notes}
            </p>
          )}
          {/* An outline: titles and notes only, nothing built yet. Say
           * what the user is asked to do with it. */}
          {isOutline(scenes) && (
            <div
              role="status"
              className="mt-6 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm leading-relaxed text-foreground"
            >
              <p className="font-medium">Outline, waiting for your review</p>
              <p className="mt-1 text-muted-foreground">
                Nothing is built yet. Check the titles, the order, and the note on each slide. Edit
                a title by clicking it, or add and delete slides here. Then tell Claude what to
                change, or to go ahead and build the pictures and captions.
              </p>
            </div>
          )}
        </header>

        <ol className="mt-10 space-y-8">
          {scenes.map((scene, i) => {
            const start = runningStart;
            runningStart += scene.durationMs;
            const timeline = captionTimeline(scene);
            const media = scene.media;

            return (
              <li key={scene.id} className="rounded-2xl border border-border bg-card/40 p-6 sm:p-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.32em] text-support">
                    Slide {i + 1} · {scene.theme} · {scene.id}
                  </p>
                  <div className="flex items-center gap-3">
                    <p className="text-xs tabular-nums text-support">
                      {seconds(start)} → {seconds(start + scene.durationMs)} ·{" "}
                      <span className="text-foreground/80">{seconds(scene.durationMs)}</span>
                    </p>
                    {canEdit && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => addSlide(i + 1)}
                          aria-label="Add a slide after this one"
                          title="Add a slide after this one"
                          className="rounded-full border border-border p-1.5 text-support transition-colors hover:text-foreground"
                        >
                          <Plus className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void commitEdit(showcase.id, scene.id, { field: "scene.delete" })
                          }
                          aria-label="Delete this slide (Cmd/Ctrl+Z undoes)"
                          title="Delete this slide (Cmd/Ctrl+Z undoes)"
                          className="rounded-full border border-border p-1.5 text-support transition-colors hover:text-red-400"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-5 flex flex-col gap-6 sm:flex-row">
                  {media.kind === "graphic" && (
                    <div className="flex w-28 shrink-0 flex-col gap-2">
                      <GraphicThumb
                        component={media.component}
                        caption={media.file ?? media.graphic}
                      />
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setPickerScene(scene)}
                          className="text-left text-[0.65rem] text-primary/80 transition-colors hover:text-primary"
                        >
                          Change media…
                        </button>
                      )}
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
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setPickerScene(scene)}
                          className="text-left text-[0.65rem] text-primary/80 transition-colors hover:text-primary"
                        >
                          Change media…
                        </button>
                      )}
                    </div>
                  )}
                  {media.kind === "none" && canEdit && (
                    <div className="flex w-28 shrink-0 flex-col">
                      <button
                        type="button"
                        onClick={() => setPickerScene(scene)}
                        aria-label="Choose media from the assets library"
                        title="Choose media from the assets library"
                        className="flex aspect-[16/10] w-full items-center justify-center rounded-lg border border-dashed border-border/70 text-support transition-colors hover:border-foreground/40 hover:text-foreground"
                      >
                        <ImagePlus className="size-4" />
                      </button>
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
                    {scene.note && (
                      <p className="mt-3 border-l-2 border-border pl-3 text-xs leading-relaxed text-support">
                        {scene.note}
                      </p>
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
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() =>
                                  void commitEdit(showcase.id, scene.id, {
                                    field: "caption.delete",
                                    captionIndex: ci,
                                  })
                                }
                                aria-label="Delete this caption (Cmd/Ctrl+Z undoes)"
                                title="Delete this caption (Cmd/Ctrl+Z undoes)"
                                className="ml-auto shrink-0 self-start rounded-full p-1 text-support/60 transition-colors hover:text-red-400"
                              >
                                <X className="size-3.5" />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() =>
                          void commitEdit(showcase.id, scene.id, {
                            field: "caption.insert",
                            captionIndex: scene.captions.length,
                            caption: { text: "New caption" },
                          })
                        }
                        className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-dashed border-border/70 px-3 py-1.5 text-xs text-support transition-colors hover:border-foreground/40 hover:text-foreground"
                      >
                        <Plus className="size-3" /> Add caption
                      </button>
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
          {canEdit && (
            <li>
              <button
                type="button"
                onClick={() => addSlide(scenes.length)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 py-6 text-sm text-support transition-colors hover:border-foreground/40 hover:text-foreground"
              >
                <Plus className="size-4" /> Add slide
              </button>
            </li>
          )}
        </ol>
      </div>
      {pickerScene && (
        <MediaPicker showcase={showcase} scene={pickerScene} onClose={() => setPickerScene(null)} />
      )}
      <div className="fixed inset-x-0 bottom-0">
        <DiagnosticsTray />
      </div>
    </ShowcaseFrame>
  );
}
