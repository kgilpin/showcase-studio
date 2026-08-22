import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileQuestion, Music, TriangleAlert } from "lucide-react";
import { getShowcase, showcaseAssets, type AssetInfo } from "@/content/showcases";
import { DiagnosticsTray } from "@/components/showcase/DiagnosticsTray";
import { HomeBackNav } from "@/components/showcase/HomeBackNav";
import { studio } from "@/lib/studio";
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

function AssetsScreen() {
  const { showcaseId } = Route.useParams();
  const showcase = getShowcase(showcaseId);
  const [selectedName, setSelectedName] = useState<string | null>(() =>
    typeof window === "undefined" ? null : sessionStorage.getItem(`assets-selected:${showcaseId}`),
  );
  const [inStudio, setInStudio] = useState(false);
  useEffect(() => setInStudio(Boolean(studio()?.assets)), []);
  if (!showcase) return null; // the layout route renders the not-found message

  const { assets, missing } = showcaseAssets(showcase);
  const selected = assets.find((a) => a.name === selectedName) ?? null;
  const select = (name: string) => {
    setSelectedName(name);
    sessionStorage.setItem(`assets-selected:${showcaseId}`, name);
  };

  return (
    <main
      className="min-h-dvh w-full px-6 py-14 sm:px-10"
      style={{ background: "var(--gradient-stage)" }}
    >
      <div className="mx-auto max-w-6xl">
        <HomeBackNav showcaseId={showcaseId} backLabel="Back to the showcase" />
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

        <div className="mt-10 flex flex-col gap-10 lg:flex-row">
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

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
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
      <div className="fixed inset-x-0 bottom-0">
        <DiagnosticsTray />
      </div>
    </main>
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
  if (!asset) {
    return (
      <aside className="w-full shrink-0 lg:w-80">
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
    <aside className="w-full shrink-0 lg:w-80">
      <div className="rounded-2xl border border-border bg-card/40 p-5">
        <div className="flex max-h-72 items-center justify-center overflow-hidden rounded-lg bg-background/40">
          {asset.kind === "video" ? (
            <video src={asset.url} controls playsInline className="max-h-72 w-full" />
          ) : asset.kind === "audio" ? (
            <audio src={asset.url} controls className="w-full p-4" />
          ) : (
            <Thumb asset={asset} className="max-h-72 w-full" />
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
          </div>
        )}
      </div>
    </aside>
  );
}
