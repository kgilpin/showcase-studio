/* Studio settings: the gear button at the right end of a showcase's top
 * bar (ShowcaseFrame), which opens a small panel of studio-wide options:
 *
 *   gear button ──► panel ──► Subscription: Active · Renews Nov 20 ·
 *                               Manage subscription ↗   (LicensePanel)
 *                             [Commit changes to git  (switch)]
 *                                on main
 *                             [Build media when it changes  (switch)]
 *
 * While the subscription needs the user — the trial, a checkout, a
 * payment issue — the gear carries a dot (amber for a payment issue)
 * and its tooltip says so: "Studio settings · Trial · 2 videos left".
 * That is the top bar's only sign of it; the Subscription section here
 * has what to do.
 *
 * The commit switch saves autoCommit in the studio's settings.json
 * through the studio server (history-auto-commit) and applies to every
 * showcase at once; the build switch saves autoBuild the same way
 * (media-auto-build, server/auto-build.mjs): off, a recorded or voiced
 * showcase's media is built only before an export or on request. When commits can't happen here at all — git isn't installed, the
 * library isn't in a git repository, or .gitignore hides it — the switch
 * is disabled and its tooltip says why, in the studio's own words.
 *
 * The status is read again whenever the panel opens, the window gains
 * focus, and after each toggle, so a `git init` run in a terminal shows
 * up without a reload. Renders nothing when no studio serves the page. */
import { useCallback, useEffect, useId, useState } from "react";
import { Settings } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { studio, useAutoBuild, useLicense, type StudioHistory } from "@/lib/studio";
import { LicensePanel } from "./LicensePanel";
import { autoBuildExplanation } from "./auto-build-text";
import { autoCommitExplanation } from "./auto-commit-text";
import { settingsNotice } from "./license-actions";

/** The labeled switch on its own, so it can be drawn without a studio
 *  (and tested). `saving` disables it while a change is on its way. */
export function AutoCommitSwitch({
  status,
  saving = false,
  onChange,
}: {
  status: StudioHistory | null | undefined;
  saving?: boolean;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  const switchId = `${id}-switch`;
  const descriptionId = `${id}-description`;
  const unavailable = !status?.available;
  const disabled = unavailable || saving;
  const on = Boolean(status?.available && status.enabled);
  const explanation = autoCommitExplanation(status);
  const detail =
    status === undefined
      ? "Checking…"
      : unavailable
        ? "Not available"
        : on
          ? status?.branch
            ? `on ${status.branch}`
            : "on"
          : "off";

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor={switchId} className={unavailable ? "opacity-70" : undefined}>
            Commit changes to git
          </Label>
          <p className="mt-1 truncate text-xs text-muted-foreground" aria-hidden="true">
            {detail}
          </p>
          <p id={descriptionId} className="sr-only">
            {explanation}
          </p>
        </div>
        <Tooltip>
          {/* A disabled button fires no pointer events, so the tooltip
           * hangs on a wrapper; it takes focus only while the switch
           * can't, so keyboard users can still reach the explanation. */}
          <TooltipTrigger asChild>
            <span
              className="inline-flex shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              tabIndex={unavailable ? 0 : undefined}
              aria-describedby={unavailable ? descriptionId : undefined}
            >
              <Switch
                id={switchId}
                checked={on}
                disabled={disabled}
                aria-disabled={disabled || undefined}
                aria-describedby={descriptionId}
                onCheckedChange={onChange}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-64">
            {explanation}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

/** The "Build media when it changes" switch on its own. `on` is null
 *  until the studio has said. */
export function AutoBuildSwitch({
  on,
  saving = false,
  onChange,
}: {
  on: boolean | null;
  saving?: boolean;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  const switchId = `${id}-switch`;
  const descriptionId = `${id}-description`;
  const disabled = on === null || saving;
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor={switchId}>Build media when it changes</Label>
          <p className="mt-1 truncate text-xs text-muted-foreground" aria-hidden="true">
            {on === null ? "Checking…" : on ? "on" : "off"}
          </p>
          <p id={descriptionId} className="sr-only">
            {autoBuildExplanation(on)}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex shrink-0 rounded-full">
              <Switch
                id={switchId}
                checked={on === true}
                disabled={disabled}
                aria-disabled={disabled || undefined}
                aria-describedby={descriptionId}
                onCheckedChange={onChange}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-64">
            {autoBuildExplanation(on)}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

export function StudioSettings() {
  const [inStudio, setInStudio] = useState(false);
  useEffect(() => setInStudio(Boolean(studio()?.history)), []);
  const [open, setOpen] = useState(false);
  const license = useLicense();
  const [status, setStatus] = useState<StudioHistory | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoBuild = useAutoBuild();
  const [savingBuild, setSavingBuild] = useState(false);

  const refresh = useCallback(async () => {
    const client = studio();
    if (client) setStatus(await client.history.status());
  }, []);

  useEffect(() => {
    if (!inStudio) return undefined;
    void refresh();
    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [inStudio, refresh]);

  if (!inStudio) return null;

  const notice = settingsNotice(license);
  const gearLabel = notice ? `Studio settings · ${notice.label}` : "Studio settings";

  const change = async (on: boolean) => {
    setSaving(true);
    setError(null);
    const result = await studio()!.history.setAutoCommit(on);
    if (!result.ok) setError(result.error ?? "The setting wasn't saved");
    if (result.history) setStatus(result.history);
    else await refresh();
    setSaving(false);
  };

  const changeBuild = async (on: boolean) => {
    setSavingBuild(true);
    setError(null);
    const result = await studio()!.builds.setAuto(on);
    if (!result.ok) setError(result.error ?? "The setting wasn't saved");
    setSavingBuild(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          void refresh();
          void studio()!.license.refresh();
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={gearLabel}
          title={gearLabel}
          className="relative -mr-2 inline-flex shrink-0 rounded-full p-2 text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground"
        >
          <Settings className="size-4" />
          {notice && (
            <span
              aria-hidden="true"
              className={cn(
                "absolute right-1.5 top-1.5 size-2 rounded-full ring-2 ring-background",
                notice.tone === "attention" ? "bg-amber-500" : "bg-primary",
              )}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 focus:outline-none"
        /* Opening the panel would focus the switch, and focus opens its
         * tooltip over the page. Focus the panel itself instead; Tab
         * still reaches the switch, and its tooltip opens then. */
        tabIndex={-1}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
        /* Keys pressed here (Space on the switch) must not reach the
         * player's shortcuts on window. */
        onKeyDown={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted-foreground">
          Studio settings
        </p>
        {license && (
          <div className="mb-4 border-b border-border pb-4">
            <LicensePanel license={license} close={() => setOpen(false)} />
          </div>
        )}
        <AutoCommitSwitch status={status} saving={saving} onChange={(on) => void change(on)} />
        <div className="mt-4 border-t border-border pt-4">
          <AutoBuildSwitch
            on={autoBuild}
            saving={savingBuild}
            onChange={(on) => void changeBuild(on)}
          />
        </div>
        {error && (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
