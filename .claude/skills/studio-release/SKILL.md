---
name: studio-release
description: Release Showcase Studio from main — bump the version, build the signed and notarized Mac app, tag, let CI build Windows, publish the GitHub release with all four assets, and verify the install as a user. Use when the user asks to release, ship, or publish a new version of the app.
argument-hint: "[version, e.g. 0.2.2 — default: next patch]"
---

# Release Showcase Studio

The user asked for: $ARGUMENTS

Precondition: the code to release is on `main`. Everything else this
skill checks or does itself. Work through the steps in order; each one
says what "done" looks like. Stop and tell the user when a check fails —
don't work around it.

```
preflight + behavior review ─► version commit ─► Mac build (signed + notarized) ─► push main + tag
                                                                                         │
                              CI builds Windows from the tag ◄───────────────────────────┘
                                          │
      GitHub release: Mac zip + SHA256SUMS now, Windows zip + SHA256SUMS-win-x64 when CI is done
                                          │
                       install through the plugin's installer, check it, report
```

## 1. Preflight

All of these must hold before anything is changed:

```sh
git status --short            # nothing modified or staged (untracked leftovers are fine)
git rev-parse --abbrev-ref HEAD   # main
git fetch origin && git rev-list --left-right --count origin/main...main   # 0 0
gh auth status                # logged in
security find-identity -v -p codesigning | grep "Developer ID Application"   # one line
xcrun notarytool history --keychain-profile showcase-studio | head -3         # no error
ls electron/node_modules/electron >/dev/null                                 # npm run setup:desktop was run
```

Then the checks that CI would run, locally:

```sh
npx vitest run && npx eslint . && npx tsc --noEmit -p .
```

Then a behavior review of everything since the last release, with the
`appmap-review` skill. The tests say the code does what its tests
check; the review says what changed in what the code actually does,
including changes nobody meant to make.

The committed gold traces can be older than the code, so record fresh
ones first and compare those with the last tag:

```sh
node ~/.claude/skills/appmap-gold-traces/assets/manage.mjs update --record --dry-run
node ~/.claude/skills/appmap-review/assets/review.mjs compare --base $(git describe --tags --abbrev=0) --fresh
```

The AppMap skills are installed for the user, not kept in this repo (the
README's "The AppMap skills" says how). If those paths don't exist, say
so and stop rather than releasing without the review.

The dry run records into `tmp/appmap` (ignored by git) and blesses
nothing. Then interpret the compare as the `appmap-review` skill says,
and give the user its report.

| Review result | What to do |
| --- | --- |
| a 🔴 finding | stop: it is fixed on `main` before the release |
| a 🟡 finding | show it and ask whether it blocks the release |
| every change explained | go on |

When the dry run says it would bless traces, the committed baselines
are behind the code. Ask whether to bless them (`update` without
`--dry-run`) in their own commit on `main` before the version commit,
so the next release's review starts from them.

The notarization profile is a keychain item made once with
`xcrun notarytool store-credentials showcase-studio --key <.p8> --key-id <id> --issuer <uuid>`
(an App Store Connect API key from Kevin Gilpin's own team, W92FJB3KRU,
the team of the Developer ID certificate). No credential is ever in
the repo or in a command line here.

## 2. Decide the version and see what's in it

```sh
git describe --tags --abbrev=0                      # the last release tag
git log --format='%h %s' $(git describe --tags --abbrev=0)..HEAD   # what ships
```

If nothing is on `main` since the last tag, there is nothing to release:
say so and stop.

The version is `$ARGUMENTS` when given, else the last tag plus one patch
level. Four files carry versions, and they all change in one commit:

| File | What |
| --- | --- |
| `package.json` `version` | the app |
| `package-lock.json` `version` (both places) | the same number — `npm i` writes it, or edit it |
| `plugins/showcase-studio/app-version` | the app version the plugin installs — same number |
| `plugins/showcase-studio/.claude-plugin/plugin.json` `version` | the plugin — its own number, +1 patch (`claude plugin update` only looks at this) |

Commit them as `Version X.Y.Z; plugin A.B.C installs it`, with a line or
two on what the release is. **Do not push yet**: once `app-version` is on
`main`, plugin updates try to download release `vX.Y.Z`, so the push
waits until the Mac zip is ready and the release can follow within
seconds.

## 3. Build the Mac app, signed and notarized

```sh
APPLE_KEYCHAIN_PROFILE=showcase-studio npm run release:desktop
```

Notarization takes a few minutes. Run it in the background and check the
log. Done means all of:

- the build log's `signing` line says `identityName=Developer ID Application: Kevin Gilpin`
  — `Apple Development` there means the Developer ID certificate wasn't found, and the build is not shippable;
- the log says `notarization successful`;
- `spctl -a -vv "dist-electron/dist/mac-arm64/Showcase Studio.app"` prints `accepted` and `source=Notarized Developer ID`;
- `xcrun stapler validate` on the same app says the validate action worked;
- `dist-electron/dist/SHA256SUMS` has exactly one line, for `Showcase-Studio-X.Y.Z-mac-arm64.zip`, and `shasum -a 256 -c SHA256SUMS` in that folder says OK. (The installer checks every line, so a stray line for an older zip would break installs.)

If notarization fails, `xcrun notarytool log <submission id> --keychain-profile showcase-studio`
explains why; the submission id is in the build log. Fix, rebuild, and
only then continue. Nothing has been pushed, so `git reset --hard origin/main`
undoes the version commit if the release is abandoned.

## 4. Tag and push

```sh
git tag -a vX.Y.Z -m "Showcase Studio X.Y.Z"
git push origin main vX.Y.Z
```

The tag push starts the Windows build (`.github/workflows/desktop-build.yml`).
Note its run id: `gh run list -L 3 --json databaseId,event,headBranch` — the
`push` event on branch `vX.Y.Z`.

## 5. Publish the release, Mac first

Right after the push, so plugin updates find it:

```sh
gh release create vX.Y.Z dist-electron/dist/Showcase-Studio-X.Y.Z-mac-arm64.zip dist-electron/dist/SHA256SUMS \
  --title "Showcase Studio X.Y.Z" --latest --notes-file <notes>
```

The notes: what changed since the last tag, grouped for a user (Mac,
Windows, plugin, everything else), from the commit list in step 2, in
plain sentences. Say that the Windows files are added when the CI build
finishes.

## 6. Add the Windows build when CI finishes

```sh
gh run watch <run id> --exit-status --interval 20
gh run download <run id> -n showcase-studio-win-x64 -D <folder>
gh release upload vX.Y.Z <folder>/Showcase-Studio-X.Y.Z-win-x64.zip <folder>/SHA256SUMS-win-x64
```

If the `Tests` step fails on Windows with
`EBUSY: resource busy or locked, rmdir ...Temp\studio-...`, a test's temp
folder was still held open when it was deleted. The studio's close now
waits for its watcher and any running git commit, and the tests retry
the delete for six seconds, so this should be rare: `gh run rerun <run id> --failed`
once, and if it repeats, treat it as real. Any other failure is real —
read `gh run view <run id> --log-failed` and stop.

Done means `gh release view vX.Y.Z --json assets` lists four assets:
the Mac zip, `SHA256SUMS`, the Windows zip and `SHA256SUMS-win-x64`.

## 7. Verify as a user

Install the release the way the plugin does, onto this Mac:

```sh
sh plugins/showcase-studio/bin/install-app
```

It must download `vX.Y.Z`, pass the checksum, and install to
`~/Applications/Showcase Studio.app`. Then:

```sh
plutil -extract CFBundleShortVersionString raw ~/Applications/Showcase\ Studio.app/Contents/Info.plist   # X.Y.Z
spctl -a -vv ~/Applications/Showcase\ Studio.app        # accepted, Notarized Developer ID
ELECTRON_SMOKE=/tmp/smoke.png ~/Applications/Showcase\ Studio.app/Contents/MacOS/Showcase\ Studio   # prints "smoke: captured"
```

Run the installer with `sh`, not `bash`: on a Mac, `/bin/sh` is bash 3.2,
which is what Claude Code uses to run it, and it has caught bugs the
newer shells don't.

## 8. Report

Tell the user: the version, the release URL, the four assets, the
signing identity and notarization result, the Windows run's result, and
the install check. If a step was skipped or is still pending (the
Windows upload, say), say so plainly.
