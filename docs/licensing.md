# Licensing

Status: built and running on dev (Stripe test mode). The service is in
`cdk/lib/license-stack.ts` and `cdk/lambda-license/`; the studio side
is `server/license.mjs` and the components in `src/components/studio/`
(`LicensePill`, `SubscribeDialog`). Prod isn't set up yet.

## The rules

- Without a subscription, each computer gets **2 free full-quality
  videos in all** (`video`, `video-43`). There is no monthly reset.
- Drafts, App Store screenshots and the script are always free.
- After that it needs a subscription: **$9.50/month** through Stripe.
- A license key works on **any number of computers**. Each licensed
  export is logged with the key and the computer, so a key shared
  widely shows up (see "Spotting a shared key"). A limit can come later.

## The pieces

| Piece           | Where                                          | Job                                                                                    |
| --------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| Stripe          | Stripe (SiteForward LLC)                       | Takes payment, renews monthly, emails receipts, hosts the Customer Portal              |
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

| Request                                          | Who calls it                               | Answer                                                                          |
| ------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------- |
| `POST /checkout` (form)                          | a Buy button                               | `303` to Stripe Checkout                                                        |
| `POST /checkout` (JSON `{ deviceId }`)           | the studio                                 | `{ checkoutUrl, licenseKey }`                                                   |
| `POST /webhook`                                  | Stripe                                     | `200` once handled; `400` on a bad signature                                    |
| `GET /thanks?session_id=cs_…[&from=studio]`      | Stripe sends the buyer here                | an HTML page with the key                                                       |
| `GET /cancelled[?from=studio]`                   | Stripe, if the buyer backs out             | an HTML page: nothing was charged                                               |
| `GET /back`                                      | the Customer Portal's return link          | "You can close this tab"                                                        |
| `POST /check` `{ licenseKey?, deviceId? }`       | the studio                                 | `valid`, `status`, `validUntil`, `renews`, `freeExports: { used, limit, left }` |
| `POST /export` `{ deviceId, licenseKey?, kind }` | the studio, as a full-quality video starts | `{ allowed, licensed, licenseProblem?, freeExports? }`                          |
| `POST /portal` `{ licenseKey }`                  | the studio's Manage subscription           | `{ url }` of Stripe's Customer Portal                                           |

## The table

One DynamoDB table, key `pk`:

| `pk`                             | Holds                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `LICENSE#SS-XXXX-XXXX-XXXX-XXXX` | `status` (`pending` until paid), `validUntil`, `cancelAtPeriodEnd`, `subscriptionId`, `stripeCustomerId`, `lastEventAt`, `machineCount` |
| `SUB#sub_…`                      | `licenseKey` — finds the license from a Stripe event                                                                                    |
| `USE#<key>#<device id>`          | `firstSeen`, `lastSeen`, `exports`: one row per computer a key exported from                                                            |
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

## Spotting a shared key

Every licensed export writes `USE#<key>#<device>` and, the first time a
computer shows up, adds one to the license's `machineCount`. It also
logs one line to CloudWatch:

```
{"audit":"export","licenseKey":"SS-…","deviceId":"…","kind":"video","devices":2}
```

To list keys used on more than 3 computers:

```bash
aws dynamodb scan --profile siteforward --region us-east-1 --table-name <the Licenses table> --filter-expression "machineCount > :n" --expression-attribute-values '{":n":{"N":"3"}}' --projection-expression "licenseKey, machineCount"
```

## The studio

| Where                       | What                                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/license.mjs`        | the computer's ID, the key in `settings.json`, the check before a full-quality video, the offline rule, the checkout and its waiting                                                            |
| `server/studio-server.mjs`  | asks it before every export (`recordedExport`), so the Export button, the Share page, `--export` and Claude's `export` tool all meet the same rule; page actions `license-*`; a `license` event |
| `LicensePill`               | the tab bar pill while there's something to do: **Trial · 2 videos left**, **Waiting for payment…**, **Payment issue** (amber). A subscription in good standing has no pill                     |
| `StudioSettings` (the gear) | the Subscription section: **Subscribed · Active**, "Renews Nov 20", Manage subscription ↗                                                                                                       |
| `SubscribeDialog`           | opened by Full quality… (Showcase page) and Export (Share page) when no free videos are left                                                                                                    |

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

|         | Dev                                                    |
| ------- | ------------------------------------------------------ |
| AWS     | `siteforward` profile, account 765035994448, us-east-1 |
| Stripe  | SiteForward LLC (`acct_1SZYeoFIehZOhU97`), test mode   |
| Price   | `price_1URDCoFIehZOhU97xvFghjDp`                       |
| Webhook | `we_1URDCtFIehZOhU97GkN8wFLV`                          |

Prod is not set up yet. It uses the same Stripe account in live mode.

Stripe, in test mode first:

1. Make a product "Showcase Studio" with a $9.50/month recurring price.
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
