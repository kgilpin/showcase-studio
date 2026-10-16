# Licensing

Status: a sketch. The service is built (`cdk/lib/license-stack.ts`,
`cdk/lambda-license/`) but not deployed, and the studio doesn't call it
yet.

## The rules

- Without a license, a computer gets **2 free exports per calendar
  month**. Drafts don't count.
- After that it needs a license: **$10/month**, a Stripe subscription.
- One license covers **up to 3 computers**. The license key is the
  account: entering it in the studio adds that computer; the studio can
  also take one off to make room.

## The pieces

| Piece           | Where                                         | Job                                                                                   |
| --------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| Stripe          | Stripe                                        | Takes payment, renews monthly, emails receipts, sends events                          |
| License service | AWS: one Lambda + one DynamoDB table (`cdk/`) | Makes keys, tracks status and devices, counts free exports, serves the thank-you page |
| Studio          | `server/`                                     | Stores the key, adds this computer, asks before each export                           |
| Website         | Cloudflare Pages (later)                      | A Buy button that posts to the service                                                |

For now everything runs on the Lambda's generated Function URL
(`https://<id>.lambda-url.us-east-1.on.aws/`). No custom domain and no
website is needed to sell a license: a Buy button anywhere — the
website, a link from the studio — is a form that posts to `/checkout`.

## The flow

```
  Buy button               Stripe                  License service (AWS)
  ──────────               ──────                  ─────────────────────
  [Buy] ── POST /checkout ─────────────────────────► makes a Checkout session
        ◄──────────────── 303 to Stripe ─────────────┘
        ──► Stripe Checkout page
            buyer pays ──────► subscription made
                               │
                               ├─ POST /webhook ───► checks the signature
                               │  (signed event)     makes the license key
                               │                     ──► DynamoDB table
                               │                     ──► key written onto the
                               │                         Stripe customer
                               │
                               └─ sends buyer to ──► GET /thanks?session_id=…
                                                     finds (or makes) the key
                                                     shows it, with [Copy]

  Studio
  ──────
  user pastes key ── POST /devices/add { key, deviceId, name } ──► added (or full)
                     key saved in settings.json
  before an export ─ POST /export { deviceId, licenseKey } ──────► allowed?
  once a day ─────── POST /check  { licenseKey, deviceId } ──────► valid until? devices?

  Every month Stripe renews ── POST /webhook (subscription.updated) ──► new end date
  User cancels            ── POST /webhook (subscription.deleted) ──► status canceled
```

The thank-you page and the webhook race: the buyer can land on
`/thanks` before Stripe's webhook arrives. So `/thanks` asks Stripe
about the checkout itself and makes the license if the webhook hasn't
yet. Both paths make at most one license per subscription (a
conditional write on `SUB#<subscription id>`).

## The endpoints

One Lambda, one Function URL, routed by path. The URL is the stack's
`LicenseApiUrl` output.

| Request                                              | Who calls it                                  | Answer                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `POST /checkout`                                     | a Buy button (a plain `<form method="post">`) | `303` to Stripe Checkout                                                                                   |
| `POST /webhook`                                      | Stripe                                        | `200` once handled; `400` on a bad signature                                                               |
| `GET /thanks?session_id=cs_…`                        | Stripe sends the buyer here                   | an HTML page with the key                                                                                  |
| `GET /cancelled`                                     | Stripe, if the buyer backs out                | an HTML page: nothing was charged                                                                          |
| `POST /check` `{ licenseKey?, deviceId? }`           | the studio                                    | `valid`, `validUntil`, `renews`, `devices`, `thisDevice`, and `freeExports: { used, limit, left, resets }` |
| `POST /devices/add` `{ licenseKey, deviceId, name }` | the studio, when a key is entered             | the device list; `409` when 3 are already on it                                                            |
| `POST /devices/remove` `{ licenseKey, deviceId }`    | the studio's License panel                    | the device list                                                                                            |
| `POST /export` `{ deviceId, licenseKey? }`           | the studio, as a counted export starts        | `{ allowed, licensed, licenseProblem?, freeExports? }`                                                     |

The Buy button is just:

```html
<form method="post" action="<CheckoutUrl output>">
  <button>Buy — $10/month</button>
</form>
```

Stripe returns the buyer to the service's own `/thanks` and
`/cancelled` pages. Those are fixed in code, so nobody can use
`/checkout` to send a buyer somewhere else. When the website is ready,
it can take those two pages over (the website's `/thanks` would call
the service for the key).

## The table

One DynamoDB table, key `pk`:

| `pk`                             | Holds                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `LICENSE#SS-XXXX-XXXX-XXXX-XXXX` | `status`, `validUntil`, `cancelAtPeriodEnd`, `subscriptionId`, `stripeCustomerId`, `lastEventAt`, `devices: { <device id>: { name, addedAt } }` |
| `SUB#sub_…`                      | `licenseKey` — finds the license from a Stripe event                                                                                            |
| `EXPORTS#<device id>#2026-10`    | `count`; deleted by TTL ~100 days after the month starts                                                                                        |

A license is good while its status is `active`, `trialing` or
`past_due` and the paid period hasn't ended more than 3 days ago. The 3
days cover a late renewal webhook and Stripe's card retries.

Stripe doesn't promise to send events in order. Each license remembers
the time of the last event it applied and ignores older ones.

## How the key reaches the user — without sending email ourselves

We send no email (no SES). Two places carry the key:

1. **The thank-you page** (`/thanks`) shows it, with a Copy button.
   Reloading it shows the same key. It could later offer a
   `showcase-studio://license?key=…` link once the app registers that
   URL scheme.
2. **Stripe's own emails.** When the license is made, the service
   writes the key onto the Stripe customer as an invoice custom field
   ("License key") and as metadata. Stripe then prints it on every
   invoice, so each monthly receipt carries it, and support can find a
   customer by key in the Stripe dashboard. _Check in test mode that
   the field shows in the receipt email itself and not only in the
   invoice PDF._

If writing to Stripe fails, the license is still made; the thank-you
page is the main path.

## Devices

The license key is the account: whoever has it can add and remove
computers. There is no login, so there is no password reset and no
email to send.

```
  License panel (studio)
  ┌───────────────────────────────────────────────┐
  │  License  SS-7K2M-…     active, renews Nov 15  │
  │                                                │
  │  Computers (2 of 3)                            │
  │   • Kevin's MacBook Pro   (this computer)      │
  │   • Studio iMac           [Remove]             │
  └───────────────────────────────────────────────┘
```

- **Entering a key** calls `/devices/add` with this computer's ID and
  its name (`os.hostname()`). If 3 are already on the license, the
  studio shows the list and lets the user remove one.
- **An export** is licensed only from a computer on the license. From
  any other, `/export` answers `licenseProblem: "device-not-added"` and
  counts it as a free export, so the studio can say "This computer
  isn't on your license — add it".
- **Sharing a key:** someone could add a friend's computer and remove
  it later. That's fine for now; if it becomes a problem, limit how many
  removals a license gets per month.

## The studio

### Storing the key

In `settings.json` through `server/settings.mjs`, beside the other
settings:

```json
"license": {
  "key": "SS-XXXX-XXXX-XXXX-XXXX",
  "lastCheck": {
    "valid": true,
    "thisDevice": true,
    "validUntil": "2026-11-15T12:00:00.000Z",
    "checkedAt": "2026-10-15T12:00:00.000Z"
  }
}
```

The user pastes the key into a License panel (under the gear button,
beside "Commit changes to git"). The studio adds this computer with
`/devices/add` and saves the key only if that works.

### Offline

The studio checks the license at most once a day, and on start. If the
service can't be reached, it trusts the last good check (`valid` and
`thisDevice`) for **7 days** after `checkedAt`. After that, counted
exports need a connection.

```
  counted export starts
       │
       ├─ online ──► POST /export ──► allowed? ──► run / refuse
       │
       └─ offline ─► lastCheck good and checkedAt < 7 days ago? ──► run
                     else free exports left on this computer (local count)? ──► run
                     else ──► refuse: "Connect to the internet to export"
```

### Where free exports are counted

**On the server, by device ID.**

|               | Count on the computer only | Count on the server by device ID            |
| ------------- | -------------------------- | ------------------------------------------- |
| Reset by      | deleting `settings.json`   | changing the computer's hardware ID         |
| Works offline | yes                        | no — needs a local fallback                 |
| Server work   | none                       | one small table item per computer per month |

A count kept only on the computer resets when someone deletes one
file, and people find that quickly. A server count keyed by the
hardware ID survives a reinstall and a new settings file. The service
is needed anyway for the license, and the same device ID is what puts a
computer on a license.

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

### Which exports count

Everything but drafts:

| Kind (`EXPORT_KINDS`)           | Counts?                                      |
| ------------------------------- | -------------------------------------------- |
| `video`, `video-43`             | yes                                          |
| `screens`                       | yes                                          |
| `script`                        | yes (it's an export too; easy to free later) |
| `video-draft`, `video-43-draft` | no                                           |

### Where the check goes (not wired yet)

Every export — the Export button, `--export`, and the `export` MCP
tool — goes through one place: `recordedExport` in
`server/studio-server.mjs` (run by `exportJobs.start` and `exportNow`).
The check belongs at its top, so every caller gets it and none can skip
it:

```js
// server/studio-server.mjs — sketch
const COUNTED_KINDS = EXPORT_KINDS.filter((kind) => !kind.endsWith("-draft"));

async function recordedExport(kind, showcaseId, { onProgress, signal } = {}) {
  if (COUNTED_KINDS.includes(kind)) {
    const verdict = await license.beforeExport(); // server/license.mjs
    if (!verdict.allowed) throw new LicenseRequired(verdict);
  }
  …
}
```

`server/license.mjs` (new) would hold the device ID, the settings read
and write, the calls to `/export`, `/check` and `/devices/*`, and the
offline rule above. It takes the service URL the same way the prompter
does (a default in code, a `licenseUrl` setting to point one machine at
Dev).

A refusal makes the job fail with a clear message. That message
reaches each caller the way errors already do:

- **The Export button**: the job's `error`, shown in the export panel,
  plus a "Buy a license" button and a field to paste a key.
- **The `export` MCP tool**: `export_status` reports the job failed,
  with the same message, so Claude can tell the user. The tool's
  description should say drafts are always free.

What the user sees at the limit:

```
  ┌───────────────────────────────────────────────────────┐
  │  You've used your 2 free exports for October.          │
  │  Drafts are always free.                               │
  │                                                        │
  │  More start on November 1, or get unlimited exports    │
  │  with a license — $10/month, up to 3 computers.        │
  │                                                        │
  │  [ Buy a license ]   [ I have a key: ____________ ]    │
  └───────────────────────────────────────────────────────┘
```

Before the limit, the export panel can say "1 free export left this
month", from `/check`'s `freeExports`.

## Setting it up

Dev is set up: the stack runs in the `kgilpin` AWS account
(852995906843, us-east-1), against the Stripe sandbox
`acct_1URBSc3JrwfKPeLF`. Prod is not set up yet.

Stripe, in test mode first:

1. Make a product "Showcase Studio" with a $10/month recurring price.
   Note its `price_…` id. Give the product a tax code (the sandbox
   uses `txcd_10103101`, "SaaS — electronic download — business use"):
   Stripe's Managed Payments, on by default, refuses a checkout for a
   product without one. With Managed Payments, Stripe is the seller of
   record and handles sales tax and VAT.
2. Deploy the stack (below) and give Stripe the `WebhookUrl` output as
   a webhook endpoint, for these events: `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Note its signing secret
   (`whsec_…`).
3. Put the three values in SSM from your shell's environment. They are
   never in the repo or the CloudFormation template:

```bash
aws ssm put-parameter --profile kgilpin --overwrite --type SecureString --name /showcase-studio/license/dev/stripe-secret-key --value "$STRIPE_SECRET_KEY"
```

```bash
aws ssm put-parameter --profile kgilpin --overwrite --type SecureString --name /showcase-studio/license/dev/stripe-webhook-secret --value "$STRIPE_WEBHOOK_SECRET"
```

```bash
aws ssm put-parameter --profile kgilpin --overwrite --type String --name /showcase-studio/license/dev/stripe-price-id --value "$STRIPE_PRICE_ID"
```

The Lambda reads them once per cold start; after changing one, the
next cold start picks it up.

Deploy (from `cdk/`):

```bash
AWS_PROFILE=kgilpin npm run deploy:license -- -c environment=dev
```

Prod is the same with `-c environment=prod`. The prod table is kept if
the stack is deleted.

## Still open

- Whether Stripe's receipt email shows the invoice custom field, or
  only the invoice PDF does (check in test mode).
- 3 computers per license is a starting number (`MAX_DEVICES` in
  `license-core.mjs`).
