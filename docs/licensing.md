# Licensing

Status: built and running on dev (Stripe's sandbox) and prod (live). The service is in
`cdk/lib/license-stack.ts` and `cdk/lambda-license/`; the studio side
is `server/license.mjs` and the components in `src/components/studio/`
(`LicensePanel`, `StudioSettings`, `SubscribeDialog`). The app and the site point at prod.

## The rules

- Without a subscription, each computer gets **2 free full-quality
  videos in all** (`video`, `video-43`). There is no monthly reset.
- Drafts, App Store screenshots and the script are always free.
- After that it needs a subscription: **$9.50/month** through Stripe.
- A license key works on **any number of computers**. Each licensed
  export is logged with the key and the computer, so a key shared
  widely shows up (see "Spotting a shared key"). A limit can come later.
- **In CI, every export needs a license key**, drafts, screenshots and
  the script included. There are no free videos in CI. See "In CI".

## The pieces

| Piece           | Where                                          | Job                                                                                    |
| --------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| Stripe          | Stripe (the Showcase Studio account)           | Takes payment, renews monthly, emails receipts, hosts the Customer Portal              |
| License service | AWS: one Lambda + one DynamoDB table (`cdk/`)  | Makes keys, tracks status, counts free videos, logs licensed exports, serves the pages |
| Studio          | `server/license.mjs`, `src/components/studio/` | Shows the status, runs the checkout, asks before each full-quality video               |
| Website         | `site/` (later)                                | A Buy button that posts to the service, and a "Manage subscription" link               |

Everything runs on the Lambda's generated Function URL
(`https://<id>.lambda-url.us-east-1.on.aws/`). No custom domain or
website is needed to sell a subscription.

## Subscribing from the studio (the usual way)

```
 Studio                                     Browser
 ──────                                     ───────
 Full quality… with no free videos left
 ┌──────────────────────────────────┐
 │ You've used your 2 free videos   │
 │ [I have a key] [Not now] [Subscribe ↗]──► POST /checkout {deviceId} (JSON)
 └──────────────────────────────────┘       ◄─ { checkoutUrl, licenseKey }
                                             studio saves the key as pending,
                                             opens Stripe Checkout ──► pays
 ┌──────────────────────────────────┐                                 │
 │ Waiting for payment…  [Stop]     │◄── studio asks /check every     ▼
 └──────────────────────────────────┘    3 seconds              /thanks?…&from=studio
 paid ──► ┌──────────────────────────┐                          "You're subscribed. Go
          │ ✓ Subscription activated │                           back to Showcase Studio"
          │ Your export has started… │                           (key shown, for another
          │ [Done]                   │                            computer)
          └──────────────────────────┘
```

The key is made when checkout **starts**, not after payment:

```
  POST /checkout
    1. make a key                       SS-XXXX-…
    2. make a Stripe customer with the key on its invoices
    3. save the license as "pending"    (dropped after 2 days if unpaid)
    4. start Checkout for that customer, the key in the
       subscription's metadata
  buyer pays
    5. the webhook or /thanks, whichever comes first, finds the key in
       the subscription's metadata and turns the license on
```

So the very first invoice already carries the key, and the studio can
hold the key before payment: until it's paid, it unlocks nothing. If
the studio was closed when the payment landed, it picks the pending key
up on its next check.

A Buy button anywhere else (the website) is a plain form; the buyer
gets the key on the thank-you page and types it into the studio with
"I have a key":

```html
<form method="post" action="<CheckoutUrl output>">
  <button>Subscribe — $9.50/month</button>
</form>
```

The webhook and `/thanks` race: the buyer can land on `/thanks` before
Stripe's webhook arrives, so `/thanks` asks Stripe about the checkout
itself. Both paths link at most one license per subscription (a
conditional write on `SUB#<subscription id>`).

## The endpoints

One Lambda, one Function URL, routed by path. The URL is the stack's
`LicenseApiUrl` output.

| Request                                               | Who calls it                                                     | Answer                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `POST /checkout` (form)                               | a Buy button                                                     | `303` to Stripe Checkout                                                        |
| `POST /checkout` (JSON `{ deviceId }`)                | the studio                                                       | `{ checkoutUrl, licenseKey }`                                                   |
| `POST /webhook`                                       | Stripe                                                           | `200` once handled; `400` on a bad signature                                    |
| `GET /thanks?session_id=cs_…[&from=studio]`           | Stripe sends the buyer here                                      | an HTML page with the key                                                       |
| `GET /cancelled[?from=studio]`                        | Stripe, if the buyer backs out                                   | an HTML page: nothing was charged                                               |
| `GET /back`                                           | the Customer Portal's return link                                | "You can close this tab"                                                        |
| `POST /check` `{ licenseKey?, deviceId? }`            | the studio                                                       | `valid`, `status`, `validUntil`, `renews`, `freeExports: { used, limit, left }` |
| `POST /export` `{ deviceId, licenseKey?, kind, ci? }` | the studio, as a full-quality video starts (in CI: every export) | `{ allowed, licensed, licenseProblem?, freeExports? }`                          |
| `POST /portal` `{ licenseKey }`                       | the studio's Manage subscription                                 | `{ url }` of Stripe's Customer Portal                                           |

## The table

One DynamoDB table, key `pk`:

| `pk`                             | Holds                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `LICENSE#SS-XXXX-XXXX-XXXX-XXXX` | `status` (`pending` until paid), `validUntil`, `cancelAtPeriodEnd`, `subscriptionId`, `stripeCustomerId`, `lastEventAt`, `machineCount` |
| `SUB#sub_…`                      | `licenseKey` — finds the license from a Stripe event                                                                                    |
| `USE#<key>#<device id>`          | `firstSeen`, `lastSeen`, `exports`: one row per computer a key exported from; `ci: true` when the "computer" is a repository's CI runs  |
| `FREE#<device id>`               | `count`: the computer's free videos used, in all                                                                                        |

A license is good while its status is `active`, `trialing` or
`past_due` and the paid period hasn't ended more than 3 days ago. The 3
days cover a late renewal webhook and Stripe's card retries.

Stripe doesn't promise to send events in order. Each license remembers
the time of the last event it applied and ignores older ones.

## How the key reaches the user — no email of our own

1. **The thank-you page** shows it, with a Copy button.
2. **Stripe's emails.** The key is an invoice custom field ("License
   key") on the customer, so every invoice carries it, and the customer
   can be found by key in the Stripe dashboard (metadata
   `license_key`).
3. **The Customer Portal** lists the invoices, so a lost key can be
   found there too.

## Managing the subscription

Stripe's Customer Portal: change the card, see invoices, cancel. The
studio's **Manage subscription** (under the gear) calls `/portal` with
the saved key — the key proves who's asking, so there's no login. What
the portal offers is set in Stripe under Settings → Billing → Customer
portal. Cancelling there sends the same webhook events, and the license
ends with the paid period.

## Coupons for testers

Checkout takes Stripe promotion codes, and asks for a card only when
something is due (`payment_method_collection: if_required`). So a code
that makes the first months free needs no card at all.

To make one: in Stripe, Product catalog → Coupons → New. For example
100% off, duration "Repeating" for 3 months, then add a promotion code
(say `BOSTON-BETA`) with a redemption limit. The tester clicks Subscribe
in the studio and enters the code at checkout.

```
checkout with code ──► $0 invoice, no card ──► license active
                                                    │
                     free months end, no card ──────┤
                                                    ▼
                     invoice fails ──► past_due ──► good for 3 more days, then ends
                                                    │
                     tester adds a card in Manage subscription ──► active again
```

Without a code, checkout is unchanged: it asks for a card.

## In CI

The studio is in CI when the `CI` environment variable is `true` or
`1`. GitHub Actions, GitLab, CircleCI and most other CI systems set it.
The repository is public under the Elastic License 2.0, which forbids
getting around a license-key check, so the studio trusts this variable
and asks for no further proof.

```
 any export (screens, script, video, video-draft, video-43, video-43-draft)
      │   from the Export button, the Share page, --export, Claude's export
      │   tool, or the export:* scripts
      ▼
 SHOWCASE_STUDIO_LICENSE_KEY set? ── no ──► refused, nothing sent
      │ yes
      ▼
 POST /export { deviceId: <the repository>, kind, licenseKey, ci: true }
      │
      ├─ service can't be reached ──► refused (no offline grace in CI)
      ├─ key unknown, pending or ended ──► refused (no free videos in CI)
      └─ good license ──► the export runs
```

| What                | Outside CI                | In CI                                      |
| ------------------- | ------------------------- | ------------------------------------------ |
| Exports that ask    | `video`, `video-43`       | every kind                                 |
| Free videos         | 2 per computer            | none                                       |
| The key             | saved in `settings.json`  | `SHOWCASE_STUDIO_LICENSE_KEY`, never saved |
| The device          | a hash of the hardware ID | a hash of the repository                   |
| Service unreachable | 7 days on a good license  | no export                                  |

**The key** is read only from `SHOWCASE_STUDIO_LICENSE_KEY`, and never
written to settings, the library, a log or an error. A refusal says
why (not set, not a key, unknown, not paid yet, ended, or the service
couldn't be reached), that CI needs a key in that variable, and that
keys come from https://showcasestudio.dev/pricing.

**The device** is `base64url(sha256("showcase-studio:ci:" + repository))`,
so one repository counts as one computer on the license, however many
runners it uses. The repository comes from the first of these that is
set: `GITHUB_REPOSITORY`, `CI_PROJECT_PATH` (GitLab),
`BITBUCKET_REPO_FULL_NAME`, `CIRCLE_PROJECT_USERNAME`/`CIRCLE_PROJECT_REPONAME`,
`TRAVIS_REPO_SLUG`, `BUILDKITE_REPO`, `BUILD_REPOSITORY_URI` or
`BUILD_REPOSITORY_NAME` (Azure). With none of them, it's the
computer's own ID, as outside CI.

**The service**, sent `ci: true`, allows the export only with a good
license and never uses or counts a free one (`licenseProblem:
"missing"` when no key came). It marks the `USE#` row and the audit
line with `ci: true`. A studio from before this change never sends
`ci`, and gets the rules it always had. A new studio talking to a
service from before this change still refuses without a good license,
because it allows a CI export only when the answer says `licensed`.

**The export:\* scripts** (`npm run export:screens`, `export:video`,
`export:script`) don't go through the studio's `recordedExport`, so
each asks the same question itself (`ciRefusal` in
`server/license.mjs`) before it exports.

## Spotting a shared key

Every licensed export writes `USE#<key>#<device>` and, the first time a
computer shows up, adds one to the license's `machineCount`. It also
logs one line to CloudWatch:

```
{"audit":"export","licenseKey":"SS-…","deviceId":"…","kind":"video","devices":2}
```

An export from CI adds `"ci":true`.

To list keys used on more than 3 computers:

```bash
aws dynamodb scan --profile siteforward --region us-east-1 --table-name <the Licenses table> --filter-expression "machineCount > :n" --expression-attribute-values '{":n":{"N":"3"}}' --projection-expression "licenseKey, machineCount"
```

## The studio

| Where                       | What                                                                                                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/license.mjs`        | the computer's ID, the key in `settings.json`, the check before a full-quality video, the offline rule, the checkout and its waiting, and the CI rules                                                   |
| `server/studio-server.mjs`  | asks it before every export (`recordedExport`), so the Export button, the Share page, `--export` and Claude's `export` tool all meet the same rule; page actions `license-*`; a `license` event          |
| `StudioSettings` (the gear) | a dot on the gear while there's something to do, named in its tooltip: **Trial · 2 videos left**, **Waiting for payment…**, **Payment issue** (amber). A subscription in good standing has no dot        |
| `LicensePanel`              | the gear panel's Subscription section: **Subscribed · Active**, "Renews Nov 20", Manage subscription ↗, and the license key (Show, Copy), with **Use a different key** and **Remove from this computer** |
| `SubscribeDialog`           | opened by Full quality… (Showcase page) and Export (Share page) when no free videos are left                                                                                                             |

Saved in `settings.json`:

```json
"license": {
  "key": "SS-XXXX-XXXX-XXXX-XXXX",
  "pendingKey": "SS-…",
  "lastCheck": { "valid": true, "status": "active", "validUntil": "…", "renews": true, "checkedAt": "…" },
  "free": { "used": 2, "limit": 2, "left": 0 },
  "offlineUsed": 0
}
```

**The computer's ID** is not a number saved in settings (deleting the
file would reset it). It's the machine's own ID, hashed so the service
never sees the real one: macOS `IOPlatformUUID`, Windows `MachineGuid`,
Linux `/etc/machine-id`, then `base64url(sha256("showcase-studio:" + id))`.

**Offline:** a good license works for **7 days** after its last check.
Without one, the free videos left as last known can still be used, and
are counted locally until the service is back.

**When a free video is used:** as the export starts, in one atomic step
on the server. A cancelled or failed export still uses one.

**Which service:** `LICENSE_URL` in `server/license.mjs` — dev for now.
`licenseUrl` in `settings.json` or `LICENSE_URL` in the environment
points one machine elsewhere.

## Setting it up

Dev is set up:

|         | Dev                                                                                  |
| ------- | ------------------------------------------------------------------------------------ |
| AWS     | `siteforward` profile, account 765035994448, us-east-1                               |
| Stripe  | Showcase Studio sandbox (`acct_1UUULJFLhCAtadQE`)                                    |
| Price   | `price_1UUUQZFLhCAtadQEwn7sby94` ($9.50/month, lookup key `showcase_studio_monthly`) |
| Webhook | `we_1UUUaHFLhCAtadQEHzs2mVvV`                                                        |
| Portal  | configuration `bpc_1UUsIBFLhCAtadQE8IQuxyZc`, with its sign-in page                  |

Showcase Studio has a Stripe account of its own, for the same company
(SiteForward LLC), in an organization with the SiteForward LLC account.
Buyers see Showcase Studio's own name, branding, receipts and portal,
and its Stripe settings (Managed Payments, refunds) don't touch the
hosting business.

Prod is set up too:

|         | Prod                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| AWS     | `ShowcaseLicenseStack-Prod`, the same account; its service is `https://7kyveiwx2fkktga22hqmmzqu4m0xocfb.lambda-url.us-east-1.on.aws/` |
| Stripe  | Showcase Studio, live (`acct_1UUUKaFWhuwOMY0S`), with Managed Payments                                                                |
| Key     | a restricted live key: Customers, Checkout Sessions and Customer portal (write); Subscriptions, Prices and Products (read)            |
| Price   | `price_1UVE7FFWhuwOMY0SiDXFgkfP` ($9.50/month, lookup key `showcase_studio_monthly`)                                                  |
| Webhook | `we_1UVEApFWhuwOMY0SHef2qNMf`                                                                                                         |
| Portal  | configuration `bpc_1UVEBXFWhuwOMY0SWwNQV7Fr`; sign-in `https://billing.stripe.com/p/login/cNi00j1CR3tv0lqaZfdby00`                    |

The app (`LICENSE_URL` in `server/license.mjs`) and the site
(`site/src/license-service.ts`) point at prod. To test against dev, set
`licenseUrl` in the studio's settings.json to dev's service,
`https://v3vlbq2dgu6wjqv6aiqediguie0ertrl.lambda-url.us-east-1.on.aws/`.

Stripe, in test mode first:

1. Make a product "Showcase Studio" with a $9.50/month recurring price.
   Note its `price_…` id. Give the product the tax code
   `txcd_10202003`, "Downloadable Software – business use" (under
   Digital products > Software). It is downloadable software, not SaaS:
   it runs on the customer's own computer, and the subscription is how
   they pay, not what they get. Stripe's Managed Payments, on by
   default, refuses a checkout for a product without a tax code. With Managed Payments, Stripe is the seller of
   record and handles sales tax and VAT.
2. Deploy the stack (below) and give Stripe the `WebhookUrl` output as
   a webhook endpoint, for these events: `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Note its signing secret
   (`whsec_…`).
3. Put the three values in SSM from your shell's environment. They are
   never in the repo or the CloudFormation template:

```bash
aws ssm put-parameter --profile siteforward --overwrite --type SecureString --name /showcase-studio/license/dev/stripe-secret-key --value "$STRIPE_SECRET_KEY"
```

```bash
aws ssm put-parameter --profile siteforward --overwrite --type SecureString --name /showcase-studio/license/dev/stripe-webhook-secret --value "$STRIPE_WEBHOOK_SECRET"
```

```bash
aws ssm put-parameter --profile siteforward --overwrite --type String --name /showcase-studio/license/dev/stripe-price-id --value "$STRIPE_PRICE_ID"
```

The Lambda reads them once per cold start; after changing one, the
next cold start picks it up.

Deploy (from `cdk/`):

```bash
AWS_PROFILE=siteforward npm run deploy:license -- -c environment=dev
```

Prod is the same with `-c environment=prod`. The prod table is kept if
the stack is deleted.

## Still open

- Prod: a live price and webhook, `ShowcaseLicenseStack-Prod`, and
  `LICENSE_URL` pointed at it.
- Whether Stripe's receipt email shows the invoice custom field, or
  only the invoice PDF does.
- A `showcase-studio://` link from the thank-you page back into the app.
- Removing the empty Stripe customers that abandoned checkouts leave.
