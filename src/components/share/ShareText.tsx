/* The text one destination posts with — the title (YouTube Shorts and
 * YouTube), caption and hashtags — editable in place, with counters against the
 * platform's limits and the copy button. It sits in the hand-off's "copy
 * the caption" step (ShareHandoff), where the text is used.
 *
 * Each field is either shared by every destination (the publish: block's
 * default) or set for this destination only (its override):
 *
 *   Caption · all destinations      [Set just for TikTok]
 *   Caption · TikTok only           [Use the shared caption]
 *
 * An edit is saved when the field loses focus, to whichever of the two
 * the field shows — through the studio's scene-edit action (publish.set),
 * like any other in-app edit. Until something is written, the caption is
 * the showcase's description and the title is its title. */
import { useEffect, useState } from "react";
import { Copy, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  captionWithHashtags,
  normalizeHashtags,
  type DestinationId,
  type PublishField,
} from "@/content/publish-rules.mjs";
import type { ShareDestination } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { hashtagText } from "./share-format";

export type PublishEdit = {
  destination?: DestinationId | undefined;
  name: PublishField;
  value: string | string[] | null;
};

const LABELS: Record<PublishField, string> = {
  title: "Title",
  caption: "Caption",
  hashtags: "Hashtags",
};

function Counter({
  count,
  limit,
  unit,
}: {
  count: number;
  limit?: number | undefined;
  unit: string;
}) {
  if (limit == null)
    return (
      <span className="text-support">
        {count} {unit}
      </span>
    );
  return (
    <span className={cn(count > limit ? "text-red-400" : "text-support")}>
      {count}/{limit} {unit}
    </span>
  );
}

function FieldScope({
  field,
  destination,
  own,
  onUseShared,
  onUseOwn,
}: {
  field: PublishField;
  destination: ShareDestination;
  own: boolean;
  onUseShared(): void;
  onUseOwn(): void;
}) {
  const noun = LABELS[field].toLowerCase();
  return (
    <span className="flex items-center gap-2 text-xs text-support">
      <span>· {own ? `${destination.label} only` : "all destinations"}</span>
      <button
        type="button"
        onClick={own ? onUseShared : onUseOwn}
        className="text-primary underline-offset-4 hover:underline"
      >
        {own ? `Use the shared ${noun}` : `Set just for ${destination.label}`}
      </button>
    </span>
  );
}

export function ShareText({
  destination,
  saving,
  onSave,
  onCopy,
}: {
  destination: ShareDestination;
  saving: boolean;
  /** Saves one field; resolves with an error message, or null. */
  onSave(edit: PublishEdit): Promise<string | null>;
  onCopy(text: string, what: string): void;
}) {
  const { text, limits, fields, id } = destination;
  /* "Description" on YouTube, "Caption" elsewhere. */
  const captionLabel = destination.captionName === "description" ? "Description" : "Caption";
  const [title, setTitle] = useState(text.title ?? "");
  const [caption, setCaption] = useState(text.caption);
  const [tags, setTags] = useState(hashtagText(text.hashtags));
  const [tagError, setTagError] = useState<string | null>(null);
  /* Which fields this page is editing for this destination only. A field
   * that already has an override starts that way. */
  const [own, setOwn] = useState<Record<PublishField, boolean>>({
    title: text.from.title === id,
    caption: text.from.caption === id,
    hashtags: text.from.hashtags === id,
  });

  /* New saved text (a save, Claude's edit, another destination) replaces
   * a field's draft — that field's only, so saving the hashtags doesn't
   * throw away a caption being typed, and a refresh that changed nothing
   * (an export finishing) leaves every draft alone. */
  const savedTags = text.hashtags.join(" ");
  useEffect(() => setTitle(text.title ?? ""), [text.title, id]);
  useEffect(() => setCaption(text.caption), [text.caption, id]);
  useEffect(() => {
    setTags(hashtagText(savedTags ? savedTags.split(" ") : []));
    setTagError(null);
  }, [savedTags, id]);
  useEffect(() => setOwn((o) => ({ ...o, title: text.from.title === id })), [text.from.title, id]);
  useEffect(
    () => setOwn((o) => ({ ...o, caption: text.from.caption === id })),
    [text.from.caption, id],
  );
  useEffect(
    () => setOwn((o) => ({ ...o, hashtags: text.from.hashtags === id })),
    [text.from.hashtags, id],
  );

  let draftTags: string[] = text.hashtags;
  try {
    draftTags = normalizeHashtags(tags);
  } catch {
    /* Shown when the field is saved. */
  }
  /* Exactly what the copy button puts on the clipboard: the boxes as they
   * are now, joined the way this destination's caption box takes a paste. */
  const paste = captionWithHashtags({ caption, hashtags: draftTags }, id);

  const save = async (name: PublishField, value: string | string[]) => {
    const error = await onSave({
      destination: own[name] || name === "title" ? id : undefined,
      name,
      value,
    });
    if (error && name === "hashtags") setTagError(error);
  };
  const saveIfChanged = (name: PublishField) => {
    if (name === "title" && title.trim() !== (text.title ?? "")) void save("title", title);
    if (name === "caption" && caption.trim() !== text.caption) void save("caption", caption);
    if (name === "hashtags") {
      let next: string[];
      try {
        next = normalizeHashtags(tags);
      } catch (error) {
        setTagError(error instanceof Error ? error.message : String(error));
        return;
      }
      setTagError(null);
      if (next.join(" ") !== text.hashtags.join(" ")) void save("hashtags", next);
    }
  };
  const scope = (field: PublishField) => (
    <FieldScope
      field={field}
      destination={destination}
      own={own[field]}
      onUseOwn={() => setOwn((o) => ({ ...o, [field]: true }))}
      onUseShared={() => {
        setOwn((o) => ({ ...o, [field]: false }));
        if (text.from[field] === id) void onSave({ destination: id, name: field, value: null });
      }}
    />
  );
  /* Nothing written yet: the box shows the showcase's own title or
   * description as a stand-in, and that is what would be posted. */
  const fromMeta = (field: "title" | "caption") =>
    text.from[field] === "meta" ? (
      <p className="text-xs text-support">
        {field === "title"
          ? "You haven't written a title yet, so this is the showcase's title. Edit it to change what's posted."
          : "You haven't written a caption yet, so this is the showcase's description. Edit it to write the caption."}
      </p>
    ) : null;

  /* Copying also saves what was just typed, so the file and the
   * clipboard agree. */
  const copyAll = () => {
    for (const field of fields) saveIfChanged(field);
    onCopy(paste, captionLabel);
  };

  return (
    <div aria-label="Caption" aria-busy={saving} className="space-y-4">
      {fields.includes("title") && (
        <div className="space-y-1.5">
          <label className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            {/* Only YouTube has a title, so it has no shared-or-own choice. */}
            <span className="text-foreground">Title</span>
            <Counter count={[...title].length} limit={limits.title} unit="characters" />
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => saveIfChanged("title")}
            aria-label="Title"
          />
          {fromMeta("title")}
          <Button variant="ghost" size="sm" onClick={() => onCopy(title, "Title")}>
            <Copy /> Copy title
          </Button>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="flex flex-wrap items-baseline gap-2 text-foreground">
            {captionLabel} {scope("caption")}
          </span>
          <Counter count={[...paste].length} limit={limits.caption} unit="with hashtags" />
        </label>
        <Textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => saveIfChanged("caption")}
          rows={5}
          aria-label={captionLabel}
        />
        {fromMeta("caption")}
      </div>

      <div className="space-y-1.5">
        <label className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="flex flex-wrap items-baseline gap-2 text-foreground">
            Hashtags {scope("hashtags")}
          </span>
          <Counter count={draftTags.length} limit={limits.hashtags} unit="tags" />
        </label>
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          onBlur={() => saveIfChanged("hashtags")}
          placeholder="#iphone #productivity"
          aria-label="Hashtags"
          aria-invalid={tagError != null}
        />
        {tagError && <p className="text-xs text-red-400">{tagError}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={copyAll}>
          <Copy /> Copy {captionLabel.toLowerCase()} and hashtags
        </Button>
        <span className="text-xs text-support">
          {saving ? "Saving…" : "Saved to showcase.yaml"}
        </span>
      </div>

      {destination.problems.length > 0 && (
        <ul className="space-y-1.5 rounded-xl border border-amber-400/40 p-3">
          {destination.problems.map((problem) => (
            <li key={problem} className="flex gap-2 text-xs text-amber-400/90">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {problem}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
