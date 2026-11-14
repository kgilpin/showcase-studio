import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Download, ImagePlus, Plus, Trash2 } from "lucide-react";
import {
  coverFor,
  getShowcase,
  showcaseGraphicKeys,
  useShowcase,
  type Showcase,
} from "@/content/showcases";
import {
  COVER_ANCHORS,
  COVER_DESTINATIONS,
  COVER_FOCUS,
  COVER_LAYOUTS,
  COVER_TEXT_POSITIONS,
  COVER_TEXT_SIZES,
  GRAPHIC_SIZE,
  resolveCover,
  type CoverAnchor,
  type CoverDestination,
  type CoverField,
  type CoverGraphic,
} from "@/content/cover-rules.mjs";
import { commitEdit, useCanEditScenes, useEditShortcuts } from "@/lib/edits";
import { cn } from "@/lib/utils";
import { CoverView } from "@/components/cover/CoverView";
import { CoverPicturePicker } from "@/components/cover/CoverPicturePicker";
import { DiagnosticsTray } from "@/components/showcase/DiagnosticsTray";
import { ShowcaseFrame } from "@/components/showcase/ShowcaseFrame";

/* The Cover page: the showcase's cover image (cover.yaml, see
 * src/content/cover-rules.mjs), with a switch for which destination's
 * cover is shown — All (the default every destination starts from),
 * TikTok, Instagram, Shorts.
 *
 *   ┌───────────────────────┬───────────────────────────┐
 *   │ All · TikTok · Insta… │ Layout  [fade][band][split]│
 *   │                       │ Picture  key  [Change]     │
 *   │      ┌─────────┐      │ Focus / Text / Size        │
 *   │      │  cover  │      │ Graphics  + Add            │
 *   │      └─────────┘      │ ☑ Grid crop  [Save image]  │
 *   └───────────────────────┴───────────────────────────┘
 *
 * In a studio the cover is edited here: click the headline to
 * type, the picture to choose another, and the panel for the rest. With
 * All chosen an edit changes the default; with one destination chosen it
 * goes into that destination's own block, and a field it sets shows a dot
 * and "Use default". Cmd/Ctrl+Z undoes, with the showcase's other edits.
 * Without a studio the page only shows the cover. No cover.yaml yet: the
 * page offers to make one. */
export const Route = createFileRoute("/showcase/$showcaseId/cover/")({
  head: ({ params }) => {
    const showcase = getShowcase(params.showcaseId);
    return { meta: [{ title: showcase ? `Cover — ${showcase.title}` : "Cover" }] };
  },
  component: CoverScreen,
});

type Choice = "all" | CoverDestination;

const DESTINATION_IDS = Object.keys(COVER_DESTINATIONS) as CoverDestination[];

const LAYOUT_LABELS = { fade: "Fade", band: "Band", split: "Split" } as const;
const SIZE_LABELS = { s: "S", m: "M", l: "L" } as const;

function CoverScreen() {
  const { showcaseId } = Route.useParams();
  const showcase = useShowcase(showcaseId);
  const canEdit = useCanEditScenes();
  useEditShortcuts(showcaseId);
  const [choice, setChoice] = useState<Choice>("all");
  const [gridCrop, setGridCrop] = useState(true);
  const [picking, setPicking] = useState(false);
  if (!showcase) return null; // the layout route renders the not-found message

  const destination = choice === "all" ? undefined : choice;
  const cover = coverFor(showcase, destination);

  return (
    <ShowcaseFrame showcaseId={showcaseId} title={showcase.title} current="cover" fill>
      <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto p-6 @4xl/frame:flex-row @4xl/frame:overflow-hidden">
        {cover ? (
          <>
            <div className="flex min-h-0 flex-1 flex-col items-center gap-4">
              <DestinationSwitch showcase={showcase} choice={choice} onChoose={setChoice} />
              <div className="flex min-h-[60vh] w-full flex-1 items-center justify-center @4xl/frame:min-h-0">
                <CoverView
                  cover={cover}
                  gridCrop={gridCrop}
                  className="h-full max-h-[78vh] rounded-2xl border border-border shadow-2xl @4xl/frame:max-h-full"
                  edit={
                    canEdit
                      ? {
                          onHeadline: (value) =>
                            editCover(showcase, destination, "headline", value),
                          onPickPicture: () => setPicking(true),
                        }
                      : undefined
                  }
                />
              </div>
            </div>
            <CoverPanel
              showcase={showcase}
              destination={destination}
              canEdit={canEdit}
              gridCrop={gridCrop}
              onGridCrop={setGridCrop}
              onPickPicture={() => setPicking(true)}
            />
          </>
        ) : (
          <NoCover showcase={showcase} canEdit={canEdit} onMade={() => setPicking(true)} />
        )}
      </div>
      {picking && cover && (
        <CoverPicturePicker
          showcase={showcase}
          title={
            destination
              ? `Cover picture for ${COVER_DESTINATIONS[destination].label}`
              : "Cover picture"
          }
          current={cover.picture}
          onClose={() => setPicking(false)}
          onPick={(key) => editCover(showcase, destination, "picture", key)}
        />
      )}
      <div className="fixed inset-x-0 bottom-0">
        <DiagnosticsTray />
      </div>
    </ShowcaseFrame>
  );
}

function editCover(
  showcase: Showcase,
  destination: CoverDestination | undefined,
  name: CoverField,
  value: unknown,
) {
  void commitEdit(showcase.id, "", { field: "cover", destination, name, value });
}

/** No cover.yaml yet. In a studio: one button, which starts the cover
 *  with the showcase's title as its headline and opens the picture
 *  picker, so the first thing to do is choose its picture. */
function NoCover({
  showcase,
  canEdit,
  onMade,
}: {
  showcase: Showcase;
  canEdit: boolean;
  onMade: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 text-center">
      <p className="font-display text-3xl tracking-tight text-foreground">No cover yet</p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        A cover is the still image TikTok, Instagram and YouTube Shorts show before the video plays:
        a picture with a headline, and graphics if you like. Without one, each platform picks a
        frame of the video.
      </p>
      {canEdit && (
        <button
          type="button"
          onClick={() => {
            void (async () => {
              const made = await commitEdit(showcase.id, "", {
                field: "cover",
                name: "headline",
                value: showcase.title,
              });
              if (made) onMade();
            })();
          }}
          className="mt-2 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" />
          Make a cover
        </button>
      )}
    </div>
  );
}

function DestinationSwitch({
  showcase,
  choice,
  onChoose,
}: {
  showcase: Showcase;
  choice: Choice;
  onChoose: (choice: Choice) => void;
}) {
  const choices: { id: Choice; label: string; changed: boolean }[] = [
    { id: "all", label: "All", changed: false },
    ...DESTINATION_IDS.map((id) => ({
      id,
      label: COVER_DESTINATIONS[id].label,
      changed: resolveCover(showcase.coverDoc, id).overridden.length > 0,
    })),
  ];
  return (
    <div
      role="tablist"
      aria-label="Which destination's cover"
      className="flex shrink-0 rounded-full border border-border bg-background/60 p-1 text-sm"
    >
      {choices.map(({ id, label, changed }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={choice === id}
          onClick={() => onChoose(id)}
          title={changed ? `${label} has changes of its own` : undefined}
          className={cn(
            "relative rounded-full px-3.5 py-1.5 transition-colors",
            choice === id
              ? "bg-primary/15 font-medium text-foreground"
              : "text-foreground/60 hover:text-foreground",
          )}
        >
          {label}
          {changed && (
            <span aria-hidden className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
          )}
        </button>
      ))}
    </div>
  );
}

function CoverPanel({
  showcase,
  destination,
  canEdit,
  gridCrop,
  onGridCrop,
  onPickPicture,
}: {
  showcase: Showcase;
  destination: CoverDestination | undefined;
  canEdit: boolean;
  gridCrop: boolean;
  onGridCrop: (on: boolean) => void;
  onPickPicture: () => void;
}) {
  const fields = resolveCover(showcase.coverDoc, destination);
  const pictureUrl = coverFor(showcase, destination)?.pictureUrl;
  const set = (name: CoverField, value: unknown) => editCover(showcase, destination, name, value);
  const reset = (name: CoverField) =>
    destination && fields.overridden.includes(name) ? () => set(name, null) : undefined;
  const graphicKeys = showcaseGraphicKeys(showcase.id);
  const setGraphics = (graphics: CoverGraphic[]) => set("graphics", graphics);

  return (
    <aside className="flex w-full shrink-0 flex-col gap-5 @4xl/frame:w-80 @4xl/frame:overflow-y-auto">
      <Row label="Layout" overridden={reset("layout")}>
        <div className="grid grid-cols-3 gap-2">
          {COVER_LAYOUTS.map((layout) => {
            const preview = coverFor(showcase, destination);
            return (
              <button
                key={layout}
                type="button"
                disabled={!canEdit}
                aria-pressed={fields.layout === layout}
                onClick={() => fields.layout !== layout && set("layout", layout)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border p-1.5 text-xs transition-colors disabled:cursor-default",
                  fields.layout === layout
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-foreground/60 enabled:hover:border-foreground/40",
                )}
              >
                {preview && (
                  <CoverView
                    cover={{ ...preview, layout, graphics: [] }}
                    className="pointer-events-none w-full rounded"
                  />
                )}
                {LAYOUT_LABELS[layout]}
              </button>
            );
          })}
        </div>
      </Row>

      <Row label="Picture" overridden={reset("picture")}>
        <div className="flex items-center gap-3">
          <div className="flex h-16 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-background">
            {pictureUrl ? (
              <img src={pictureUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImagePlus className="size-3.5 text-support" />
            )}
          </div>
          <span className="min-w-0 flex-1 truncate text-xs text-support">
            {fields.picture ?? "No picture yet"}
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={onPickPicture}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-foreground/80 transition-colors hover:text-foreground"
            >
              <ImagePlus className="size-3.5" />
              {fields.picture ? "Change" : "Choose"}
            </button>
          )}
        </div>
      </Row>

      <Row label="Focus" overridden={reset("focus")}>
        <Segments
          values={COVER_FOCUS}
          current={fields.focus}
          disabled={!canEdit}
          onChoose={(value) => set("focus", value)}
        />
      </Row>

      <Row label="Text" overridden={reset("textPosition")}>
        <Segments
          values={COVER_TEXT_POSITIONS}
          current={fields.textPosition}
          disabled={!canEdit}
          onChoose={(value) => set("textPosition", value)}
        />
      </Row>

      <Row label="Text size" overridden={reset("textSize")}>
        <Segments
          values={COVER_TEXT_SIZES}
          labels={SIZE_LABELS}
          current={fields.textSize}
          disabled={!canEdit}
          onChoose={(value) => set("textSize", value)}
        />
      </Row>

      <Row label="Graphics" overridden={reset("graphics")}>
        <div className="flex flex-col gap-2">
          {fields.graphics.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {graphicKeys.length === 0
                ? "This showcase has no graphics yet. Ask Claude to draw one for the cover."
                : "None on the cover."}
            </p>
          )}
          {fields.graphics.map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-mono text-support">{item.graphic}</span>
              <select
                aria-label={`Where ${item.graphic} sits`}
                disabled={!canEdit}
                value={item.at}
                onChange={(event) =>
                  setGraphics(
                    fields.graphics.map((g, j) =>
                      j === i ? { ...g, at: event.target.value as CoverAnchor } : g,
                    ),
                  )
                }
                className="rounded-md border border-border bg-background px-1.5 py-1"
              >
                {COVER_ANCHORS.map((anchor) => (
                  <option key={anchor} value={anchor}>
                    {anchor}
                  </option>
                ))}
              </select>
              <input
                type="number"
                aria-label={`${item.graphic} size, percent of the width`}
                title="Size, in percent of the cover's width"
                disabled={!canEdit}
                min={GRAPHIC_SIZE.min}
                max={GRAPHIC_SIZE.max}
                step={5}
                defaultValue={item.size}
                key={`${i}-${item.size}`}
                onBlur={(event) => {
                  const size = Math.round(Number(event.target.value));
                  if (size !== item.size && size >= GRAPHIC_SIZE.min && size <= GRAPHIC_SIZE.max) {
                    setGraphics(fields.graphics.map((g, j) => (j === i ? { ...g, size } : g)));
                  }
                }}
                className="w-14 rounded-md border border-border bg-background px-1.5 py-1"
              />
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove ${item.graphic}`}
                  title="Remove"
                  onClick={() => setGraphics(fields.graphics.filter((_, j) => j !== i))}
                  className="rounded-full p-1 text-support transition-colors hover:text-foreground"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
          {canEdit && graphicKeys.length > 0 && (
            <select
              aria-label="Add a graphic"
              value=""
              onChange={(event) => {
                if (!event.target.value) return;
                setGraphics([
                  ...fields.graphics,
                  { graphic: event.target.value, at: "center", size: GRAPHIC_SIZE.default },
                ]);
              }}
              className="rounded-md border border-dashed border-border bg-background px-2 py-1.5 text-xs text-foreground/70"
            >
              <option value="">+ Add graphic…</option>
              {graphicKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          )}
        </div>
      </Row>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <label className="flex items-center gap-2 text-sm text-foreground/80">
          <input
            type="checkbox"
            checked={gridCrop}
            onChange={(event) => onGridCrop(event.target.checked)}
          />
          Show what the profile grid cuts off
        </label>
        {canEdit && (
          <a
            href={`/studio/api/cover?showcase=${encodeURIComponent(showcase.id)}${destination ? `&destination=${destination}` : ""}`}
            download
            className="inline-flex w-fit items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-foreground/80 transition-colors hover:text-foreground"
          >
            <Download className="size-4" />
            Save cover image
          </a>
        )}
      </div>
    </aside>
  );
}

function Row({
  label,
  overridden,
  children,
}: {
  label: string;
  /** Set when the chosen destination has its own value: clears it. */
  overridden?: (() => void) | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {label}
        {overridden && (
          <>
            <span
              aria-label="Changed for this destination"
              className="size-1.5 rounded-full bg-primary"
            />
            <button
              type="button"
              onClick={overridden}
              className="ml-auto text-[0.7rem] normal-case tracking-normal text-primary hover:underline"
            >
              Use default
            </button>
          </>
        )}
      </div>
      {children}
    </div>
  );
}

function Segments<T extends string>({
  values,
  labels,
  current,
  disabled,
  onChoose,
}: {
  values: readonly T[];
  labels?: Record<T, string>;
  current: T;
  disabled: boolean;
  onChoose: (value: T) => void;
}) {
  return (
    <div className="flex rounded-lg border border-border p-0.5 text-xs">
      {values.map((value) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          aria-pressed={current === value}
          onClick={() => current !== value && onChoose(value)}
          className={cn(
            "flex-1 rounded-md px-2 py-1 capitalize transition-colors disabled:cursor-default",
            current === value
              ? "bg-primary/15 font-medium text-foreground"
              : "text-foreground/60 enabled:hover:text-foreground",
          )}
        >
          {labels?.[value] ?? value}
        </button>
      ))}
    </div>
  );
}
