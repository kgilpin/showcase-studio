import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileQuestion, Music, Plus, Trash2, TriangleAlert, Upload, X } from "lucide-react";
import { getShowcase, showcaseAssets, type AssetInfo } from "@/content/showcases";
import { DiagnosticsTray } from "@/components/showcase/DiagnosticsTray";
import { ShowcaseNav } from "@/components/showcase/ShowcaseNav";
import { studio } from "@/lib/studio";
import { isGenericClipboardName, pastedAssetName } from "@/lib/pasted-asset-name";
import { isTypingTarget } from "@/lib/typing-target";
import { cn } from "@/lib/utils";

/* The media collection behind a showcase: every file in assets/, what
 * references it, and the keys referenced with no file behind them.
 * Selecting an asset shows its details on the right; in the studio it
 * can be renamed there — the file and every YAML reference together. */
export const Route = createFileRoute("/showcase/$showcaseId/assets")({
  head: ({ params }) => ({
    meta: [
      { title: `Assets — ${params.showcaseId}` },
      { name: "description", content: "The showcase's media collection." },
    ],
  }),
  component: AssetsScreen,
});

function Thumb({ asset, className }: { asset: AssetInfo; className?: string }) {
  if (asset.kind === "image") {
    return <img src={asset.url} alt={asset.name} className={cn("object-contain", className)} />;
  }
  if (asset.kind === "video") {
    return (
      <video
        src={asset.url}
        muted
        playsInline
        preload="metadata"
        className={cn("object-contain", className)}
      />
    );
  }
  return (
    <div className={cn("flex items-center justify-center text-support", className)}>
      {asset.kind === "audio" ? <Music className="size-8" /> : <FileQuestion className="size-8" />}
    </div>
  );
}

/** ArrayBuffer → base64, chunked so large videos don't blow the call
 *  stack with one giant String.fromCharCode spread. */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function AssetsScreen() {
  const { showcaseId } = Route.useParams();
  const showcase = getShowcase(showcaseId);
  const [selectedName, setSelectedName] = useState<string | null>(() =>
    typeof window === "undefined" ? null : sessionStorage.getItem(`assets-selected:${showcaseId}`),
  );
  const [inStudio, setInStudio] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  /* What the last upload is doing ("Adding 2 files…", an error). Drops,
   * browsing, and pastes all report here; the add dialog shows it. */
  const [addStatus, setAddStatus] = useState<string | null>(null);
  const assetNames = useRef<string[]>([]);
  useEffect(() => setInStudio(Boolean(studio()?.assets)), []);

  /* The one upload path: write the files into assets/ in one call. The
   * studio watcher then reloads the page with the fresh inventory — that
   * reload is the success path. */
  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setAddStatus(`Adding ${files.length} file${files.length > 1 ? "s" : ""}…`);
      const payload: { name: string; data: string }[] = [];
      for (const file of files) {
        payload.push({ name: file.name, data: toBase64(await file.arrayBuffer()) });
      }
      const result = await studio()!.assets.add({ showcaseId, files: payload });
      setAddStatus(result.ok ? "Added — reloading…" : (result.error ?? "Adding failed"));
    },
    [showcaseId],
  );

  /* Paste an image anywhere on the page (not while typing in a field) to
   * add it. Clipboard images arrive as "image.png", so they get a name
   * from the paste time instead. The add dialog opens to show progress. */
  useEffect(() => {
    if (!inStudio) return;
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e)) return;
      const images = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (images.length === 0) return;
      e.preventDefault();
      const now = new Date();
      const taken = [...assetNames.current];
      const named = images.map((file) => {
        if (!isGenericClipboardName(file.name)) return file;
        const name = pastedAssetName(file, now, taken);
        taken.push(name);
        return new File([file], name, { type: file.type });
      });
      setAddOpen(true);
      void addFiles(named);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [inStudio, addFiles]);

  if (!showcase) return null; // the layout route renders the not-found message

  const { assets, missing } = showcaseAssets(showcase);
  assetNames.current = assets.map((a) => a.name);
  const selected = assets.find((a) => a.name === selectedName) ?? null;
  const select = (name: string) => {
    setSelectedName(name);
    sessionStorage.setItem(`assets-selected:${showcaseId}`, name);
  };

  return (
    <main
      className="@container min-h-dvh w-full pb-14"
      style={{ background: "var(--gradient-stage)" }}
    >
      <ShowcaseNav
        showcaseId={showcaseId}
        title={showcase.title}
        current="assets"
        built={showcase.builtMedia}
      />
      <div className="mx-auto box-content max-w-6xl px-6 sm:px-10">
        <header className="mt-8 border-b border-border pb-8">
          <p className="text-xs uppercase tracking-[0.42em] text-primary">Assets</p>
          <h1 className="mt-4 font-display text-5xl leading-tight tracking-tight text-foreground">
            {showcase.title}
          </h1>
          <p className="mt-4 text-sm text-support">
            {assets.length} files in{" "}
            <code className="text-foreground/80">{showcaseId}/assets/</code>
            {missing.length > 0 && (
              <span className="text-amber-400/90"> · {missing.length} referenced but missing</span>
            )}
          </p>
        </header>

        <div className="mt-10 flex flex-col gap-10 @5xl:flex-row">
          <div className="min-w-0 flex-1">
            {missing.length > 0 && (
              <div className="mb-8 rounded-2xl border border-amber-400/40 bg-card/40 p-5">
                <p className="flex items-center gap-2 text-sm text-amber-400/90">
                  <TriangleAlert className="size-4" /> Referenced in the YAML, no file yet —
                  rendering as placeholders
                </p>
                <ul className="mt-3 space-y-1.5">
                  {missing.map((m) => (
                    <li key={m.key} className="text-sm text-muted-foreground">
                      <span className="font-mono text-foreground/90">{m.key}</span>
                      <span className="text-support"> — used by {m.usedBy.join(", ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 @2xl:grid-cols-3 @7xl:grid-cols-4">
              {assets.map((asset) => (
                <button
                  key={asset.name}
                  type="button"
                  onClick={() => select(asset.name)}
                  className={cn(
                    "rounded-2xl border bg-card/40 p-3 text-left transition-colors hover:bg-card/70",
                    selected?.name === asset.name
                      ? "border-primary"
                      : "border-border hover:border-primary/50",
                  )}
                >
                  <div className="flex h-32 items-center justify-center overflow-hidden rounded-lg bg-background/40">
                    <Thumb asset={asset} className="h-full w-full" />
                  </div>
                  <p className="mt-3 truncate font-mono text-xs text-foreground/90">{asset.key}</p>
                  <p className="mt-1 text-[0.7rem] text-support">
                    {asset.kind} ·{" "}
                    {asset.usedBy.length > 0
                      ? `${asset.usedBy.length} reference${asset.usedBy.length > 1 ? "s" : ""}`
                      : "unreferenced"}
                  </p>
                </button>
              ))}
              {inStudio && (
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  title="Add assets"
                  className="flex min-h-[12rem] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 bg-card/20 p-3 text-support transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  <Plus className="size-6" />
                  <span className="text-xs">Add assets</span>
                  <span className="text-[0.7rem] opacity-70">
                    or paste an image ({pasteKeys()})
                  </span>
                </button>
              )}
            </div>
          </div>

          <AssetDetails
            key={selected?.name ?? "none"}
            showcaseId={showcaseId}
            asset={selected}
            inStudio={inStudio}
            onRenamed={(name) => select(name)}
          />
        </div>
      </div>
      {addOpen && (
        <AddAssetsOverlay
          showcaseId={showcaseId}
          status={addStatus}
          onFiles={(files) => void addFiles(files)}
          onClose={() => {
            setAddOpen(false);
            setAddStatus(null);
          }}
        />
      )}
      <div className="fixed inset-x-0 bottom-0">
        <DiagnosticsTray />
      </div>
    </main>
  );
}

/** The paste shortcut as this computer spells it. Only called in the
 *  browser: the page renders these hints after it knows a studio serves it. */
function pasteKeys(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘V" : "Ctrl+V";
}

/** The drop target behind the "+" card: drag files in, click to browse,
 *  or paste. The files go to `onFiles`, and `status` reports progress. */
function AddAssetsOverlay({
  showcaseId,
  status,
  onFiles,
  onClose,
}: {
  showcaseId: string;
  status: string | null;
  onFiles: (files: File[]) => void;
  onClose: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const addFiles = (list: FileList | null) => onFiles(Array.from(list ?? []));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add assets"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <p className="text-sm text-foreground">Add assets</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-border p-1.5 text-support transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "mt-4 flex h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-colors",
            dragOver
              ? "border-primary bg-primary/5 text-foreground"
              : "border-border text-support hover:border-foreground/40 hover:text-foreground",
          )}
        >
          <Upload className="size-6" />
          <p className="text-sm">Drop files here, or click to browse</p>
          <p className="text-xs opacity-70">You can also paste an image ({pasteKeys()})</p>
          <p className="text-xs opacity-70">They land in {showcaseId}/assets/</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        {status && <p className="mt-3 text-xs text-support">{status}</p>}
      </div>
    </div>
  );
}

function AssetDetails({
  showcaseId,
  asset,
  inStudio,
  onRenamed,
}: {
  showcaseId: string;
  asset: AssetInfo | null;
  inStudio: boolean;
  onRenamed: (name: string) => void;
}) {
  const [name, setName] = useState(asset?.key ?? "");
  const [status, setStatus] = useState<string | null>(null);
  /* Two-step delete: the first click arms, the second deletes. The
   * component is keyed by asset name, so switching assets disarms. */
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!asset) {
    return (
      <aside className="w-full shrink-0 @5xl:sticky @5xl:top-22 @5xl:max-h-[calc(100dvh-7.5rem)] @5xl:w-[26rem] @5xl:self-start @5xl:overflow-y-auto @7xl:w-[30rem]">
        <p className="text-sm text-support">Select an asset to see its details.</p>
      </aside>
    );
  }

  const rename = async () => {
    setStatus(null);
    const result = await studio()!.assets.rename({ showcaseId, from: asset.name, to: name });
    if (!result.ok || !result.name) {
      setStatus(result.error ?? "Rename failed");
      return;
    }
    setStatus(
      result.updatedReferences
        ? `Renamed — ${result.updatedReferences} YAML reference${result.updatedReferences > 1 ? "s" : ""} updated`
        : "Renamed — no YAML references to update",
    );
    onRenamed(result.name);
  };

  return (
    <aside className="w-full shrink-0 @5xl:sticky @5xl:top-22 @5xl:max-h-[calc(100dvh-7.5rem)] @5xl:w-[26rem] @5xl:self-start @5xl:overflow-y-auto @7xl:w-[30rem]">
      <div className="rounded-2xl border border-border bg-card/40 p-5">
        <div className="flex max-h-96 items-center justify-center overflow-hidden rounded-lg bg-background/40">
          {asset.kind === "video" ? (
            <video src={asset.url} controls playsInline className="max-h-96 w-full" />
          ) : asset.kind === "audio" ? (
            <audio src={asset.url} controls className="w-full p-4" />
          ) : (
            <Thumb asset={asset} className="max-h-96 w-full" />
          )}
        </div>
        <dl className="mt-5 space-y-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-[0.28em] text-support">Key</dt>
            <dd className="mt-1 font-mono text-foreground/90">{asset.key}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.28em] text-support">File</dt>
            <dd className="mt-1 font-mono text-xs text-muted-foreground">{asset.name}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.28em] text-support">Used by</dt>
            <dd className="mt-1 text-muted-foreground">
              {asset.usedBy.length > 0 ? asset.usedBy.join(", ") : "nothing references it"}
            </dd>
          </div>
        </dl>

        {inStudio && (
          <div className="mt-6 border-t border-border pt-5">
            <p className="text-xs uppercase tracking-[0.28em] text-support">Rename</p>
            <div className="mt-2 flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void rename()}
                className="w-full min-w-0 rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm text-foreground outline-none"
              />
              <button
                type="button"
                onClick={() => void rename()}
                className="shrink-0 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
              >
                Rename
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-support">
              Renames the file and updates every reference in showcase.yaml.
            </p>
            {status && <p className="mt-2 text-xs text-amber-400/90">{status}</p>}

            <p className="mt-6 text-xs uppercase tracking-[0.28em] text-support">Delete</p>
            {asset.usedBy.length > 0 && (
              <p className="mt-2 text-xs leading-relaxed text-amber-400/90">
                Still referenced by {asset.usedBy.join(", ")} — deleting leaves those scenes
                rendering a missing-media placeholder.
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                void studio()!
                  .assets.remove({ showcaseId, name: asset.name })
                  .then((result) => {
                    /* On success the studio watcher reloads the page
                     * with the file gone — nothing more to do. */
                    if (!result.ok) {
                      setStatus(result.error ?? "Delete failed");
                      setConfirmDelete(false);
                    }
                  });
              }}
              className={cn(
                "mt-2 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                confirmDelete
                  ? "border-red-500/60 bg-red-500/10 text-red-400"
                  : "border-border bg-card text-foreground hover:bg-secondary",
              )}
            >
              <Trash2 className="size-4" />{" "}
              {confirmDelete ? "Really delete this file" : "Delete file…"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
