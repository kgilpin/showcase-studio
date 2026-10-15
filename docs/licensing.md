# Licensing

Status: a sketch. The service is built (`cdk/lib/license-stack.ts`,
`cdk/lambda-license/`) but not deployed, and the studio doesn't call it
yet.

## The rules

- Without a license, a Mac gets **2 free exports per calendar month**.
- After that it needs a license: **$10/month**, a Stripe subscription.

## The pieces

| Piece           | Where                                         | Job                                            |
| --------------- | --------------------------------------------- | ---------------------------------------------- |
| Website         | Cloudflare Pages (separate repo)              | Buy button, thank-you page                     |
| Stripe          | Stripe                                        | Takes payment, renews monthly, sends events    |
| License service | AWS: one Lambda + one DynamoDB table (`cdk/`) | Makes keys, tracks status, counts free exports |
| Studio          | `server/`                                     | Stores the key, asks before each export        |

## The flow

```
  Website                    Stripe                 License service (AWS)
  ───────                    ──────                 ─────────────────────
  [Buy] ── POST /checkout ─────────────────────────► makes a Checkout session
        ◄──────────────── 303 to Stripe ─────────────┘
        ──► Stripe Checkout page
            buyer pays ──────► subscription made
                               │
                               └── POST /webhook ──► checks the signature
                                   (signed event)    makes the license key
                                                     ──► DynamoDB table
  /thanks?session_id=… ◄── Stripe sends buyer back
        ── GET /claim?session_id=… ────────────────► finds (or makes) the key
        ◄─────────────────── { licenseKey } ─────────┘
  shows the key, [Copy]

  Studio
  ──────
  user pastes key ──► settings.json
  before an export ── POST /export { deviceId, licenseKey } ──► allowed?
  once a day ──────── POST /check  { licenseKey, deviceId } ──► valid until?

  Every month Stripe renews ── POST /webhook (subscription.updated) ──► new end date
  User cancels            ── POST /webhook (subscription.deleted) ──► status canceled
```

The thank-you page and the webhook race: the buyer can land on `/thanks`
before Stripe's webhook arrives. So `/claim` asks Stripe about the
checkout itself and makes the license if the webhook hasn't yet. Both
paths make at most one license per subscription (a conditional write
on `SUB#<subscription id>`).

## The endpoints

One Lambda, one Function URL, routed by path. The URL is the stack's
`LicenseApiUrl` output.

| Request                                    | Who calls it                                              | Answer                                                             |
| ------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------ |
| `POST /checkout`                           | the website's Buy button (a plain `<form method="post">`) | `303` to Stripe Checkout                                           |
| `POST /webhook`                            | Stripe                                                    | `200` once handled; `400` on a bad signature                       |
| `GET /claim?session_id=cs_…`               | the thank-you page (CORS allows the website's origin)     | `{ licenseKey, valid, status, validUntil, renews }`                |
| `POST /check` `{ licenseKey?, deviceId? }` | the studio                                                | license status and/or `freeExports: { used, limit, left, resets }` |
| `POST /export` `{ deviceId, licenseKey? }` | the studio, as an export starts                           | `{ allowed, licensed, freeExports? }`                              |

The Buy button on the website is just:

```html
<form method="post" action="https://<LicenseApiUrl>/checkout">
  <button>Buy — $10/month</button>
</form>
```

Stripe returns the buyer to `<websiteUrl>/thanks?session_id=…` after
paying and to `<websiteUrl>/pricing` if they back out. Those two pages
are fixed in the stack (`-c websiteUrl=…`), so nobody can use
`/checkout` to send a buyer somewhere else.

## The table

One DynamoDB table, key `pk`:

| `pk`                             | Holds                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `LICENSE#SS-XXXX-XXXX-XXXX-XXXX` | `status`, `validUntil`, `cancelAtPeriodEnd`, `subscriptionId`, `stripeCustomerId`, `lastEventAt` |
| `SUB#sub_…`                      | `licenseKey` — finds the license from a Stripe event                                             |
| `EXPORTS#<device id>#2026-10`    | `count`; deleted by TTL ~100 days after the month starts                                         |

A license is good while its status is `active`, `trialing` or
`past_due` and the paid period hasn't ended more than 3 days ago. The 3
days cover a late renewal webhook and Stripe's card retries.

Stripe doesn't promise to send events in order. Each license remembers
the time of the last event it applied and ignores older ones.

## How the key reaches the user

1. **The thank-you page** shows it, with a Copy button. This is the
   main path. It could also offer a `showcase-studio://license?key=…`
   link once the app registers that URL scheme.
2. **Email.** Stripe's own receipt can't carry the key. Two choices
   for later: send our own email from the webhook (Amazon SES, once the
   website's domain is verified there), or write the key into the
   subscription's metadata so it shows in the Stripe dashboard, and
   answer "I lost my key" by hand at first. Recommend the dashboard
   metadata now (one extra Stripe call) and SES when there are enough
   customers to need it.

Reloading the thank-you page shows the same key. Anyone who has the
`session_id` URL can see the key, the same as anyone who has the
buyer's receipt email.

## The studio

### Storing the key

In `settings.json` through `server/settings.mjs`, beside the other
settings:

```json
"license": {
  "key": "SS-XXXX-XXXX-XXXX-XXXX",
  "lastCheck": {
    "valid": true,
    "validUntil": "2026-11-15T12:00:00.000Z",
    "checkedAt": "2026-10-15T12:00:00.000Z"
  }
}
```

The user pastes the key into a License panel (under the gear button,
beside "Commit changes to git"). The studio checks it at once with
`/check` and saves it only if it's good.

### Offline

The studio checks the license at most once a day, and on start. If the
service can't be reached, it trusts the last good check for **7 days**
after `checkedAt` — as long as `validUntil` plus that week hasn't
passed. After that, exports need a connection.

```
  export starts
       │
       ├─ online ──► POST /export ──► allowed? ──► run / refuse
       │
       └─ offline ─► lastCheck.valid and checkedAt < 7 days ago? ──► run
                     else free exports left on this Mac (local count)? ──► run
                     else ──► refuse: "Connect to the internet to export"
```

### Where free exports are counted

**Recommendation: on the server, by device ID.**

|               | Count on the Mac only    | Count on the server by device ID       |
| ------------- | ------------------------ | -------------------------------------- |
| Reset by      | deleting `settings.json` | changing the Mac's hardware ID         |
| Works offline | yes                      | no — needs a local fallback            |
| Server work   | none                     | one small table item per Mac per month |

A count kept only on the Mac resets when someone deletes one file, and
people find that quickly. A server count keyed by the Mac's hardware ID
survives a reinstall and a new settings file. The service is needed
anyway for the license, so counting there costs one more request.

The device ID is not a random number saved in settings (that resets
just like a local count). It is the machine's own ID, hashed so the
server never sees the real one:

- macOS: `IOPlatformUUID` (from `ioreg -rd1 -c IOPlatformExpertDevice`)
- Windows: `MachineGuid` (registry, `HKLM\SOFTWARE\Microsoft\Cryptography`)
- `deviceId = base64url(sha256("showcase-studio:" + id))`

Offline, the studio falls back to its own count in `settings.json`,
with the same rule (2 a month). The free tier is a nudge, not a lock;
the goal is that getting around it is more trouble than $10.

The count goes up when the export **starts**, in one atomic step on the
server. So a cancelled or failed export still uses one. Counting when
it finishes instead is a small change if that turns out to annoy
people.

### Where the check goes (not wired yet)

Every export — the Export button, `--export`, and the `export` MCP
tool — goes through one place: `exportJob` / `exportJobs.start` in
`server/studio-server.mjs`, which runs `recordedExport`. The check
belongs at the top of `recordedExport` (or in a wrapper passed to
`createExportJobs`), so every caller gets it and none can skip it:

```js
// server/studio-server.mjs — sketch
async function recordedExport(kind, showcaseId, { onProgress, signal } = {}) {
  if (COUNTED_KINDS.includes(kind)) {           // see "Open questions"
    const verdict = await license.beforeExport(); // server/license.mjs
    if (!verdict.allowed) throw new LicenseRequired(verdict);
  }
  …
}
```

`server/license.mjs` (new) would hold the device ID, the settings
read and write, the call to `/export`, and the offline rule above. It
takes the service URL the same way the prompter does (a default in
code, a `licenseUrl` setting to point one machine at Dev).

A refusal makes the job fail with a clear message. That message
reaches each caller the way errors already do:

- **The Export button**: the job's `error`, shown in the export panel,
  plus a "Buy a license" button and a field to paste a key.
- **The `export` MCP tool**: `export_status` reports the job failed,
  with the same message, so Claude can tell the user.

What the user sees at the limit:

```
  ┌───────────────────────────────────────────────────────┐
  │  You've used your 2 free exports for October.          │
  │                                                        │
  │  More start on November 1, or get unlimited exports    │
  │  with a license — $10/month.                           │
  │                                                        │
  │  [ Buy a license ]   [ I have a key: ____________ ]    │
  └───────────────────────────────────────────────────────┘
```

And before the limit, the export panel can say "1 free export left this
month", from `/check`'s `freeExports`.

## Setting it up (not done — needs your go-ahead)

Stripe, in test mode first:

1. Make a product "Showcase Studio" with a $10/month recurring price.
   Note its `price_…` id.
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

Prod needs the website's address:
`-c environment=prod -c websiteUrl=https://<the site>`. The prod table
is kept if the stack is deleted.

## Open questions

1. **Which exports count?** Full video only, or also drafts, the 4:3
   videos, App Store screenshots and the script? A suggestion: count
   `video` and `video-43` (the files people post), leave drafts,
   screenshots and the script free. Drafts are how people check their
   work, and the script is just text.
2. **Does one license cover several Macs?** The service doesn't limit
   it today: any Mac with the key is licensed. If it should be limited
   (say, 3 Macs), `/export` and `/check` already get the device ID, so
   the license item can keep a list of devices and refuse a new one
   past the limit.
3. **Email** — send our own (SES) now, or start with the thank-you
   page and the Stripe dashboard?
4. **The website's address** for prod (`-c websiteUrl=…`), and whether
   its pages are `/thanks` and `/pricing`.
