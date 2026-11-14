# Deploying

Three things deploy outside the app release: the shared-teleprompter site
and the license service (both AWS, in `cdk/`), and the marketing site
(Cloudflare, in `site/`). The app itself is released with the
`studio-release` skill (`.claude/skills/studio-release`).

| What              | Where it runs                   | Code                      | Deploy command                                             |
| ----------------- | ------------------------------- | ------------------------- | ---------------------------------------------------------- |
| Teleprompter site | S3 + CloudFront + a Lambda, AWS | `web/prompter/`, `cdk/`   | `npx cdk deploy -c environment=dev` (in `cdk/`)            |
| License service   | DynamoDB + a Lambda, AWS        | `cdk/` (`bin/license.ts`) | `npm run deploy:license -- -c environment=dev` (in `cdk/`) |
| Marketing site    | A Cloudflare Worker             | `site/`                   | `npm run deploy` (in `site/`)                              |

All AWS deploys use `AWS_PROFILE=siteforward`.

## Environments: dev and prod

Both AWS stacks use the same convention as the siteforward stack:
`-c environment=dev|prod`, with dev as the default.

| Stack           | dev                         | prod                         |
| --------------- | --------------------------- | ---------------------------- |
| Teleprompter    | `ShowcasePrompterStack-Dev` | `ShowcasePrompterStack-Prod` |
| License service | `ShowcaseLicenseStack-Dev`  | `ShowcaseLicenseStack-Prod`  |

Dev is free to push.

## The teleprompter site

Build it first (`npm run build:prompter` at the root), then:

```sh
cd cdk && npm install
AWS_PROFILE=siteforward npx cdk deploy -c environment=dev
```

The studio publishes to Prod by default (`PROMPTER_PUBLISH_URL` in
`server/studio-server.mjs`). To point one machine at Dev, set
`prompterPublishUrl` in the studio settings, or the `PROMPTER_PUBLISH_URL`
environment variable.

What the stack holds:

- A private S3 bucket behind CloudFront. The edge rewrites `/p/<token>`
  to the page. `/scripts/*` is never cached. Scripts expire after 30 days.
- One open Lambda publish endpoint, reached by its Function URL.
  `cdk/lambda/publish-core.mjs` holds the rules; `publish.mjs` wires them
  to S3.

Anyone may publish. A new script gets a token made by the server (the
link) and an edit key. Only that edit key can update the script. S3 keeps
only the key's hash, as object metadata that CloudFront strips. Tokens
are unguessable links: there is no login and no listing.

On the studio side, the `prompter-publish` action saves `{ token, editKey }`
in the settings' `prompterLinks`, keyed by the showcase folder's full
path, so publishing again updates the narrator's existing link. A moved
folder keeps its link when exactly one saved folder of the same name no
longer exists. An expired link is replaced by a new one, and the share
dialog says so.

## The license service

Its own CDK app (`bin/license.ts`, `lib/license-stack.ts`) in the
siteforward AWS account. It uses Showcase Studio's own Stripe account
(same company, SiteForward LLC, a separate account). Dev is deployed
against that account's Stripe sandbox; prod is deployed and live. The app
and the site point at prod; `licenseUrl` in settings.json points one
machine at dev. Stripe keys live in SSM, never in the repo.
`docs/licensing.md` has the design and the one-time Stripe and SSM setup.

```sh
cd cdk && npm run synth:license
AWS_PROFILE=siteforward npm run deploy:license -- -c environment=dev
```

It runs on its generated Function URL, thank-you page included, so it
needs no website. One DynamoDB table and one Lambda, routed by path:

| Path                             | What it does                                                                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/checkout`                      | A Buy button's form post gets a 303 to Stripe Checkout. The studio's JSON request gets the checkout URL and the license key. The key is made before payment and written onto the new Stripe customer, so every invoice carries it. |
| `/webhook`                       | Stripe's events, signature checked.                                                                                                                                                                                                |
| `/thanks`, `/cancelled`, `/back` | The pages Stripe returns a buyer to.                                                                                                                                                                                               |
| `/check`                         | License status and a machine's free exports.                                                                                                                                                                                       |
| `/export`                        | 2 free full-quality exports per machine in all. With a good license, any number, each logged with the key and the machine, so a shared key shows up.                                                                               |
| `/portal`                        | Stripe's Customer Portal for the key's customer.                                                                                                                                                                                   |

The rules are in `lambda-license/license-core.mjs`. The other files there
wire them to DynamoDB, Stripe (plain fetch) and SSM.

Tests: the rules run with the rest (`npm test` at the root), and on their
own in the cdk package (`cd cdk && npm test`). `cdk/` has its own
`appmap.yml` and gold traces in `cdk/gold_traces/` (the purchase, the
webhook's signature check, the free-video limit, a licensed export). Run
the gold-traces engine with `--dir cdk/gold_traces`.

## The marketing site

Live at https://showcasestudio.dev. A TanStack Start app, prerendered to
static files and served by a Cloudflare Worker (`showcase-studio`, from
`site/wrangler.toml`). Nothing deploys it on push: deploy by hand.

```sh
cd site && npm i
npx wrangler login       # once, in a browser (npx wrangler whoami says which account)
npm run deploy           # build, upload site/dist/client, serve it at showcasestudio.dev
npm run deploy:preview   # build and upload a version without serving it
```

The Pricing page's two links (`site/src/license-service.ts`) are prod:
real money.

### Two Cloudflare accounts, until the domain moves

`wrangler.toml` names no account, so a deploy goes to whichever account
wrangler is logged in to. The domain is in the goo.global account. It
moves to the SiteForward account around 2026-10-26. Until then:

```
showcasestudio.dev ── /download/* ──► showcase-studio-downloads ──► R2 bucket
(goo.global Worker,                   (SiteForward Worker on       showcase-studio-
 no bucket)                            workers.dev)                releases
```

A Worker can only read a bucket in its own account, so the site's Worker
relays downloads to the same `worker.js` deployed beside the bucket.

- `wrangler login` is SiteForward.
- goo.global is the wrangler auth profile `goo` (`npx wrangler auth create goo`).

`npm run deploy` runs both deploys:

```sh
wrangler deploy --env goo --profile goo   # the site, in goo.global
wrangler deploy --env downloads           # the downloads Worker, in SiteForward
```

Releases upload to the SiteForward bucket only (`npm run publish-release`,
unchanged).

After the move, switch back with the five steps at the end of
`site/wrangler.toml`: the plain deploy scripts in `site/package.json`, no
env sections or relay, `npm run deploy` as SiteForward, delete the two
Workers no longer used, then deploy on every push to main with a GitHub
Actions workflow.

### Wrangler quirks

- wrangler remembers the account in
  `site/node_modules/.cache/wrangler/wrangler-account.json`. After logging
  in as another account, delete that file, or wrangler keeps sending
  requests to the old account ("Authentication error [code: 10000]").
- wrangler refuses to run below a folder holding a stale
  `.wrangler/deploy/config.json`. An old studio build can leave one at the
  repo root, pointing at `.output/server/wrangler.json`. Delete that folder.

### Releases on the site

The bucket `showcase-studio-releases` holds `v<version>/<file>` for each
release, and `latest.json` (`{"mac": …, "win": …}`), which
`/download/latest/mac` and `/download/latest/win` redirect by.

```sh
npm run publish-release -- <mac|win> <version> <folder> [--local]
```

puts a release's zip and checksum file in the bucket and writes
`latest.json` last (`--local`: the bucket `npm run dev:wrangler` serves).
The `studio-release` skill runs it.
